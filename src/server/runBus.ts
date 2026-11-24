/**
 * Background runs, run from the BFF: a turn keeps going after the browser
 * goes away, and every open window watches it live.
 *
 * ADK's /run_sse cancels a run when its HTTP connection closes
 * (google/adk-python#4029). Here the BFF holds that connection itself, not
 * the browser: `start()` opens /run_sse and drains it in a task no request
 * owns, so closing the tab only stops watching. ADK is used as it is.
 *
 * - Every frame the run sends, partial or not, is appended to the session's
 *   Redis Stream, in 50ms batches.
 * - Each open session page keeps one feed, `openEvents()`: the stored events,
 *   then the latest run from its first entry, then every run live as it is
 *   written, from any process. It never ends by itself; the next run wakes
 *   it through the same stream key.
 * - `StreamHub` serves all of a process's feeds with one blocking XREAD over
 *   every watched key, so Redis connections grow with processes, not tabs.
 * - Stop is a request: the owner aborts its /run_sse request, and ADK
 *   cancels the run (and stores its INVOCATION_ABORTED marker). A cancel
 *   that lands on another process goes through a Redis flag.
 *
 * Redis keys (all prefixed and all expiring, since the production Redis is
 * shared with rumors-line-bot and has no `maxmemory`):
 *
 * - `cofacts-ai:run:{user}:{sid}`: the lock. JSON `{runId, owner}` for a
 *   run, `{stateWrite}` while a session-state write happens.
 * - `cofacts-ai:stream:{user}:{sid}`: the stream. Entries are
 *   `{runId, type, partial, data}`; `type` is `event` or `done`.
 * - `cofacts-ai:cancel:{user}:{sid}`: a cancel request for the run whose
 *   `runId` it holds.
 *
 * See docs/decisions/20261114-background-runs-redis-streams.md.
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { createClient } from 'redis'

export type Redis = ReturnType<typeof createClient>

const KEY_PREFIX = 'cofacts-ai'

export const LIMITS = {
  lockTtlMs: 30_000,
  lockRenewMs: 10_000,
  /** While a run is going, its stream outlives a dead owner by this long. */
  streamTtlS: 60,
  /** After a run ends, slow viewers get this long to read its end. */
  streamTtlAfterDoneS: 30,
  streamMaxLen: 20_000,
  cancelTtlS: 600,
  cancelPollMs: 1_000,
  writeBatchMs: 50,
  /** A feed waits this long before a heartbeat (Cloudflare cuts at 125s). */
  feedBlockMs: 20_000,
  /** How long the hub's XREAD waits before taking in newly watched keys. */
  hubBlockMs: 1_000,
  /** A session-state write holds the lock this long at most. */
  stateWriteLockMs: 5_000,
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_SECONDS || 900) * 1000,
  /** After aborting a run, how long to wait for ADK to store its marker. */
  abortMarkerWaitMs: 2_000,
}

export type RunEnd = 'completed' | 'cancelled' | 'interrupted'

export const lockKey = (u: string, s: string) => `${KEY_PREFIX}:run:${u}:${s}`
export const streamKey = (u: string, s: string) =>
  `${KEY_PREFIX}:stream:${u}:${s}`
export const cancelKey = (u: string, s: string) =>
  `${KEY_PREFIX}:cancel:${u}:${s}`

// Renews the lock only while it is still ours; takes it back if it is gone
// (Redis restarted) and nobody else has it.
const RENEW_LOCK = `
local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
elseif not v then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 2
end
return 0`

// Deletes the lock only while it is still ours.
const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`

// ---- SSE helpers -----------------------------------------------------------

const encoder = new TextEncoder()
export const HEARTBEAT = ': heartbeat\n\n'
export const dataFrame = (data: string) => `data: ${data}\n\n`
export const historyFrame = (data: string) =>
  `event: history\ndata: ${data}\n\n`
export const endFrame = (outcome: string) => `event: end\ndata: ${outcome}\n\n`
export const syncedFrame = (running: boolean) =>
  `event: synced\ndata: ${JSON.stringify({ running })}\n\n`

/** The `data:` payloads of an SSE body, one per frame. */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        let data = ''
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) data += line.slice(6)
        }
        if (data) yield data
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ---- stream entries --------------------------------------------------------

export interface Entry {
  id: string
  runId: string
  type: 'event' | 'done'
  partial: boolean
  data: string
}

type RawEntry = { id: string; message: Record<string, string> }

function toEntry({ id, message: f }: RawEntry): Entry {
  return {
    id,
    runId: f.runId ?? '',
    type: f.type === 'done' ? 'done' : 'event',
    partial: f.partial === '1',
    data: f.data ?? '',
  }
}

/** "ms-seq" as a comparable pair. */
function streamId(id: string): [number, number] {
  const [ms, seq] = id.split('-')
  return [Number(ms), Number(seq ?? 0)]
}
export function idAfter(a: string, b: string) {
  const [am, as] = streamId(a)
  const [bm, bs] = streamId(b)
  return am > bm || (am === bm && as > bs)
}

/**
 * Drops partial entries that a later complete event already covers: only the
 * message still being typed needs its partials.
 */
export function compactBacklog(entries: Array<Entry>) {
  let lastComplete = -1
  entries.forEach((e, i) => {
    if (e.type === 'event' && !e.partial) lastComplete = i
  })
  return entries.filter((e, i) => !e.partial || i > lastComplete)
}

// ---- ADK access (injected, so tests can fake ADK) ---------------------------

export interface StoredEvent {
  id?: string
  invocationId?: string
  author?: string
  partial?: boolean | null
  errorCode?: string | null
  timestamp?: number
  content?: { role?: string | null } | null
}

export interface AdkAccess {
  /** Opens ADK's /run_sse for a new message. */
  runSse: (args: {
    userId: string
    sessionId: string
    newMessage: unknown
    token: string | undefined
    signal: AbortSignal
  }) => Promise<Response>
  /** The session's stored events (null when the session doesn't exist). */
  sessionEvents: (
    userId: string,
    sessionId: string,
  ) => Promise<Array<StoredEvent> | null>
  /** Writes session state (ADK's PATCH). */
  patchState: (
    userId: string,
    sessionId: string,
    stateDelta: Record<string, unknown>,
  ) => Promise<void>
}

// ---- the writer ------------------------------------------------------------

/** XADD's MAXLEN ~ cap; a function so tests can lower LIMITS.streamMaxLen. */
function trim() {
  return {
    TRIM: {
      strategy: 'MAXLEN' as const,
      strategyModifier: '~' as const,
      threshold: LIMITS.streamMaxLen,
    },
  }
}

/** Appends entries to a run's stream in batches (see WRITE_BATCH). */
class StreamWriter {
  private buf: Array<Record<string, string>> = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> = Promise.resolve()

  constructor(
    private redis: Redis,
    private key: string,
    private runId: string,
  ) {}

  put(data: string, partial: boolean) {
    this.buf.push({
      runId: this.runId,
      type: 'event',
      partial: partial ? '1' : '0',
      data,
    })
    this.timer ??= setTimeout(() => {
      this.timer = null
      void this.flush()
    }, LIMITS.writeBatchMs)
  }

  flush() {
    const batch = this.buf.splice(0)
    if (!batch.length) return this.flushing
    this.flushing = this.flushing.then(async () => {
      try {
        const pipe = this.redis.multi()
        for (const fields of batch) {
          pipe.xAdd(this.key, '*', fields, trim())
        }
        pipe.expire(this.key, LIMITS.streamTtlS)
        await pipe.execAsPipeline()
      } catch (err) {
        // Viewers miss these entries; a feed catches up from the session
        // store at the run's end. The run itself goes on.
        console.error(`[runBus] writing ${batch.length} entries failed`, err)
      }
    })
    return this.flushing
  }

  async close() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.flush()
  }
}

// ---- runs ------------------------------------------------------------------

interface Run {
  runId: string
  userId: string
  sessionId: string
  lockValue: string
  controller: AbortController
  end: RunEnd | null
  done: Promise<void>
}

export class RunBusUnavailable extends Error {}
/** ADK refused to start the run (e.g. 404 for an unknown session). */
export class AdkRunError extends Error {
  constructor(readonly status: number) {
    super(`ADK answered ${status}`)
  }
}

export interface StartResult {
  started: boolean
}

export class RunBus {
  readonly ownerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  readonly hub: StreamHub
  private runs = new Map<string, Run>()
  private closing = false

  constructor(
    readonly redis: Redis,
    hubRedis: Redis,
    readonly adk: AdkAccess,
  ) {
    this.hub = new StreamHub(hubRedis)
  }

  private static k(userId: string, sessionId: string) {
    return `${userId}\u0000${sessionId}`
  }

  async readLock(userId: string, sessionId: string) {
    const raw = await this.redis.get(lockKey(userId, sessionId))
    if (raw === null) return null
    try {
      return JSON.parse(raw) as {
        runId?: string
        owner?: string
        stateWrite?: string
      }
    } catch {
      return null
    }
  }

  /** The lock if a run holds it; null when free or held by a state write. */
  async readRunLock(userId: string, sessionId: string) {
    const lock = await this.readLock(userId, sessionId)
    return lock?.runId ? lock : null
  }

  async lockHeld(userId: string, sessionId: string, runId: string) {
    return (await this.readRunLock(userId, sessionId))?.runId === runId
  }

  private release(key: string, value: string) {
    return this.redis.eval(RELEASE_LOCK, { keys: [key], arguments: [value] })
  }

  /**
   * Starts a run unless the session already has one (`started: false`).
   * Returns once ADK has accepted it; its events then come on the feed.
   */
  async start(args: {
    userId: string
    sessionId: string
    newMessage: unknown
    token: string | undefined
  }): Promise<StartResult> {
    const { userId, sessionId } = args
    if (this.closing) throw new RunBusUnavailable('shutting down')

    const runId = randomUUID().replaceAll('-', '')
    const lockValue = JSON.stringify({ runId, owner: this.ownerId })
    const key = lockKey(userId, sessionId)
    const deadline = Date.now() + LIMITS.stateWriteLockMs
    while (
      (await this.redis.set(key, lockValue, {
        condition: 'NX',
        expiration: { type: 'PX', value: LIMITS.lockTtlMs },
      })) !== 'OK'
    ) {
      // A run holds the session: the caller watches that one instead. A
      // session-state write holds it for a moment: wait it out.
      if (await this.readRunLock(userId, sessionId)) return { started: false }
      if (Date.now() > deadline) return { started: false }
      await new Promise((r) => setTimeout(r, 50))
    }

    const controller = new AbortController()
    let response: Response
    try {
      // shutdown() may have begun while we took the lock; it won't see us.
      if (this.isClosing()) throw new RunBusUnavailable('shutting down')
      // The stream key is per session; drop whatever a previous run left.
      await this.redis.del(streamKey(userId, sessionId))
      response = await this.adk.runSse({ ...args, signal: controller.signal })
      if (!response.ok || !response.body) {
        throw new AdkRunError(response.status)
      }
    } catch (err) {
      // No drain task yet to release the lock.
      await this.release(key, lockValue).catch(() => {})
      throw err
    }

    const run: Run = {
      runId,
      userId,
      sessionId,
      lockValue,
      controller,
      end: null,
      done: Promise.resolve(),
    }
    this.runs.set(RunBus.k(userId, sessionId), run)
    run.done = this.drain(run, response.body)
    return { started: true }
  }

  /**
   * Waits for ADK to store the marker of a run we aborted. ADK writes it
   * after it notices the closed connection, with the text the stopped
   * message had streamed (KeepPartialOnAbortPlugin), so the run's end, and
   * the feeds' catch-up at that end, must come after it. Holding the lock
   * until then also keeps a new run from starting while ADK still writes.
   */
  private async abortMarker(
    userId: string,
    sessionId: string,
    invocationId: string,
  ) {
    const deadline = Date.now() + LIMITS.abortMarkerWaitMs
    while (Date.now() < deadline) {
      const stored = await this.adk
        .sessionEvents(userId, sessionId)
        .catch(() => null)
      if (
        stored?.some(
          (e) =>
            e.invocationId === invocationId &&
            e.errorCode === 'INVOCATION_ABORTED',
        )
      ) {
        return
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  /** Asks the run to stop: aborts its /run_sse request. */
  private stop(run: Run, end: RunEnd) {
    run.end ??= end
    run.controller.abort()
  }

  private async drain(run: Run, body: ReadableStream<Uint8Array>) {
    const { userId, sessionId } = run
    const key = streamKey(userId, sessionId)
    const writer = new StreamWriter(this.redis, key, run.runId)
    const timeout = setTimeout(
      () => this.stop(run, 'interrupted'),
      LIMITS.runTimeoutMs,
    )
    let ticks = 0
    const keeper = setInterval(() => {
      ticks++
      void (async () => {
        try {
          const requested = await this.redis.get(cancelKey(userId, sessionId))
          if (requested === run.runId) this.stop(run, 'cancelled')
          if ((ticks * LIMITS.cancelPollMs) % LIMITS.lockRenewMs === 0) {
            await this.redis.eval(RENEW_LOCK, {
              keys: [lockKey(userId, sessionId)],
              arguments: [run.lockValue, String(LIMITS.lockTtlMs)],
            })
            await this.redis.expire(key, LIMITS.streamTtlS)
          }
        } catch (err) {
          console.error(`[runBus] keeping run ${run.runId} alive failed`, err)
        }
      })()
    }, LIMITS.cancelPollMs)

    let invocationId: string | undefined
    try {
      let first = true
      for await (const data of sseData(body)) {
        let event: StoredEvent = {}
        try {
          event = JSON.parse(data) as StoredEvent
        } catch {
          continue
        }
        if (first && event.invocationId) {
          first = false
          invocationId = event.invocationId
          // /run_sse doesn't send the user's message. Put the stored one
          // first, so windows watching from elsewhere see the question.
          const stored = await this.adk
            .sessionEvents(userId, sessionId)
            .catch(() => null)
          const asked = stored?.find(
            (e) =>
              e.invocationId === event.invocationId &&
              e.author === 'user' &&
              e.content?.role === 'user',
          )
          if (asked) writer.put(JSON.stringify(asked), false)
        }
        writer.put(data, event.partial === true)
      }
      run.end ??= 'completed'
    } catch (err) {
      if (!run.controller.signal.aborted) {
        console.error(`[runBus] run ${run.runId} failed`, err)
      }
      run.end ??= 'interrupted'
    } finally {
      clearTimeout(timeout)
      clearInterval(keeper)
      await writer.close()
      if (run.controller.signal.aborted && invocationId) {
        await this.abortMarker(userId, sessionId, invocationId)
      }
      try {
        await this.redis
          .multi()
          .xAdd(
            key,
            '*',
            {
              runId: run.runId,
              type: 'done',
              partial: '0',
              data: run.end ?? 'completed',
            },
            trim(),
          )
          .expire(key, LIMITS.streamTtlAfterDoneS)
          .exec()
      } catch (err) {
        console.error(`[runBus] writing the end of ${run.runId} failed`, err)
      }
      // Separately: a lock left behind makes the session look busy.
      try {
        await this.release(lockKey(userId, sessionId), run.lockValue)
        await this.redis.del(cancelKey(userId, sessionId))
      } catch (err) {
        console.error(`[runBus] releasing ${run.runId} failed`, err)
      }
      if (this.runs.get(RunBus.k(userId, sessionId)) === run) {
        this.runs.delete(RunBus.k(userId, sessionId))
      }
    }
  }

  /** Stops the session's run, wherever it runs. False when there is none. */
  async cancel(userId: string, sessionId: string) {
    const run = this.runs.get(RunBus.k(userId, sessionId))
    if (run) {
      this.stop(run, 'cancelled')
      return true
    }
    const lock = await this.readRunLock(userId, sessionId)
    if (!lock?.runId) return false
    // Another process owns it; it checks this key every second.
    await this.redis.set(cancelKey(userId, sessionId), lock.runId, {
      expiration: { type: 'EX', value: LIMITS.cancelTtlS },
    })
    return true
  }

  /**
   * Writes session state unless a run is going. Returns true if deferred.
   *
   * Any write to the session while a run is going makes the run's next write
   * fail with StaleSessionError, killing it. The write holds the session
   * lock while it happens, so no run can start in between (start() waits
   * for it). Another state write is waited out; only a run defers.
   */
  async writeState(
    userId: string,
    sessionId: string,
    stateDelta: Record<string, unknown>,
  ): Promise<boolean> {
    const key = lockKey(userId, sessionId)
    const token = JSON.stringify({ stateWrite: randomUUID() })
    const deadline = Date.now() + LIMITS.stateWriteLockMs
    while (
      (await this.redis.set(key, token, {
        condition: 'NX',
        expiration: { type: 'PX', value: LIMITS.stateWriteLockMs },
      })) !== 'OK'
    ) {
      if (await this.readRunLock(userId, sessionId)) return true
      if (Date.now() > deadline) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    try {
      await this.adk.patchState(userId, sessionId, stateDelta)
    } finally {
      await this.release(key, token).catch(() => {})
    }
    return false
  }

  /**
   * Stops every run this process owns (redeploy, scale-in). Each ends as
   * interrupted, so its viewers can offer to ask again.
   */
  async shutdown() {
    this.closing = true
    this.hub.close()
    const runs = [...this.runs.values()]
    for (const run of runs) this.stop(run, 'interrupted')
    await Promise.race([
      Promise.allSettled(runs.map((r) => r.done)),
      new Promise((r) => setTimeout(r, 2_500)),
    ])
  }

  /** Read through a method: it changes while start() awaits. */
  private isClosing() {
    return this.closing
  }

  runningCount() {
    return this.runs.size
  }

  // ---- the feed ------------------------------------------------------------

  /**
   * The session's live feed (SSE bytes). Throws SessionNotFound for an
   * unknown session. Never ends by itself; in order:
   *
   * 1. `event: history`: stored events after the event id `since` (all of
   *    them without it, or if it isn't found).
   * 2. The latest run in the Redis stream, from its first entry (plain
   *    `data:` frames, partials included), and its `event: end` if it ended.
   * 3. `event: synced` with `{"running": bool}`.
   * 4. Live: each run's frames, each followed by its `event: end`.
   *    Heartbeats every feedBlockMs.
   *
   * Complete events can arrive twice (stored, and from a replay); they carry
   * ADK's event `id` for the client to drop repeats.
   */
  async openEvents(
    userId: string,
    sessionId: string,
    since: string | null,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const stored = await this.adk.sessionEvents(userId, sessionId)
    if (stored === null) throw new SessionNotFound(sessionId)
    const frames = this.feedFrames(userId, sessionId, stored, since, signal)
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await frames.next()
          if (done) controller.close()
          else controller.enqueue(encoder.encode(value))
        } catch (err) {
          controller.error(err)
        }
      },
      async cancel() {
        await frames.return(undefined)
      },
    })
  }

  private async *feedFrames(
    userId: string,
    sessionId: string,
    stored: Array<StoredEvent>,
    since: string | null,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    let start = 0
    if (since) {
      const idx = stored.findIndex((e) => e.id === since)
      if (idx >= 0) start = idx + 1
    }
    const sent = new Set(
      stored.map((e) => e.id).filter(Boolean) as Array<string>,
    )
    const history = stored
      .slice(start)
      .filter((e) => !e.partial)
      .map((e) => historyFrame(JSON.stringify(e)))
    if (history.length) yield history.join('')

    const key = streamKey(userId, sessionId)
    const feed = new Feed(this, userId, sessionId, sent)
    const raw: Array<RawEntry> = await this.redis.xRange(key, '-', '+')
    const entries = raw.map(toEntry)
    let last = entries.at(-1)?.id ?? '0-0'
    const latest = entries.at(-1)?.runId
    if (latest) {
      const replay: Array<string> = []
      for (const e of compactBacklog(
        entries.filter((x) => x.runId === latest),
      )) {
        for await (const f of feed.take(e)) replay.push(f)
      }
      if (replay.length) yield replay.join('')
    }
    const lock = await this.readRunLock(userId, sessionId)
    const lockRun = lock?.runId ?? null
    if (feed.runId !== null && feed.runId !== lockRun) {
      // The stream's latest run never wrote its end: its owner is gone.
      for await (const f of feed.finish('interrupted')) yield f
    }
    // A run with the lock but no entries yet is running too.
    feed.runId ??= lockRun
    yield syncedFrame(feed.runId !== null)

    const { watcher, gapTo } = this.hub.subscribe(key, last)
    try {
      if (gapTo !== null) {
        // The hub was already past our starting point; read the gap.
        const gap: Array<RawEntry> = await this.redis.xRange(
          key,
          `(${last}`,
          gapTo,
        )
        for (const r of gap) {
          const e = toEntry(r)
          last = e.id
          for await (const f of feed.take(e)) yield f
        }
      }
      while (!signal.aborted) {
        const e = await watcher.next(LIMITS.feedBlockMs)
        if (e === null) {
          if (
            feed.runId !== null &&
            !(await this.lockHeld(userId, sessionId, feed.runId))
          ) {
            for await (const f of feed.finish('interrupted')) yield f
          }
          yield HEARTBEAT
          continue
        }
        if (!idAfter(e.id, last)) continue // already read with the gap
        last = e.id
        for await (const f of feed.take(e)) yield f
      }
    } finally {
      this.hub.unsubscribe(watcher)
    }
  }
}

export class SessionNotFound extends Error {}

/** One feed's view of the runs it has seen. */
class Feed {
  runId: string | null = null
  invocationId: string | null = null

  constructor(
    private bus: RunBus,
    private userId: string,
    private sessionId: string,
    private sent: Set<string>,
  ) {}

  async *take(e: Entry): AsyncGenerator<string> {
    if (e.type === 'done') {
      if (e.runId === this.runId || this.runId === null) {
        yield* this.finish((e.data || 'completed') as RunEnd)
      }
      return
    }
    if (e.runId !== this.runId) {
      if (this.runId !== null && this.invocationId) {
        // The previous run's end never reached this feed.
        yield* this.finish('interrupted')
      }
      this.runId = e.runId
      this.invocationId = null
    }
    if (!e.partial) {
      try {
        const meta = JSON.parse(e.data) as StoredEvent
        this.invocationId ??= meta.invocationId ?? null
        if (meta.id) this.sent.add(meta.id)
      } catch {
        // not JSON: pass it on as is
      }
    }
    yield dataFrame(e.data)
  }

  /**
   * Ends the run: sends its stored events the stream missed (a failed batch
   * write, MAXLEN trimming, ADK's abort marker), then the end.
   */
  async *finish(outcome: RunEnd): AsyncGenerator<string> {
    if (this.invocationId) {
      const stored = await this.bus.adk
        .sessionEvents(this.userId, this.sessionId)
        .catch(() => null)
      const missed = (stored ?? []).filter(
        (e) =>
          e.invocationId === this.invocationId &&
          !e.partial &&
          e.id &&
          !this.sent.has(e.id),
      )
      for (const e of stored ?? []) if (e.id) this.sent.add(e.id)
      if (missed.length) {
        yield missed.map((e) => historyFrame(JSON.stringify(e))).join('')
      }
    }
    this.runId = null
    this.invocationId = null
    yield endFrame(outcome)
  }
}

// ---- the hub ---------------------------------------------------------------

class Watcher {
  private queue: Array<Entry> = []
  private waiting: ((e: Entry | null) => void) | null = null

  constructor(
    readonly key: string,
    public last: string,
  ) {}

  push(e: Entry) {
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w(e)
    } else {
      this.queue.push(e)
    }
  }

  /** The next entry, or null after timeoutMs. */
  next(timeoutMs: number): Promise<Entry | null> {
    const e = this.queue.shift()
    if (e) return Promise.resolve(e)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null
        resolve(null)
      }, timeoutMs)
      this.waiting = (entry) => {
        clearTimeout(timer)
        resolve(entry)
      }
    })
  }
}

/**
 * Reads every watched session stream with one blocking Redis connection.
 *
 * Each open feed waits for its session's next entry. One loop per process
 * blocks on all watched keys at once (XREAD takes many) and hands entries to
 * the feeds. A newly watched key joins the next XREAD, within hubBlockMs. If
 * the hub is already past a new feed's starting point, the feed reads the
 * gap itself (see subscribe), so nothing is missed.
 */
export class StreamHub {
  private watchers = new Map<string, Set<Watcher>>()
  private cursors = new Map<string, string>()
  private running = false
  private closed = false

  // A method, so a read after an await isn't narrowed away by the linter.
  private isClosed() {
    return this.closed
  }

  constructor(private redis: Redis) {}

  /**
   * Starts handing the key's entries after `last` to a new watcher. Returns
   * it, and the id the hub has already reached on this key when that is
   * past `last` (the caller reads that gap itself).
   */
  subscribe(key: string, last: string) {
    const watcher = new Watcher(key, last)
    let set = this.watchers.get(key)
    if (!set) this.watchers.set(key, (set = new Set()))
    set.add(watcher)
    const cur = this.cursors.get(key)
    let gapTo: string | null = null
    if (cur === undefined) this.cursors.set(key, last)
    else if (idAfter(cur, last)) gapTo = cur
    if (!this.running && !this.closed) {
      this.running = true
      void this.loop()
    }
    return { watcher, gapTo }
  }

  unsubscribe(w: Watcher) {
    const set = this.watchers.get(w.key)
    if (!set) return
    set.delete(w)
    if (!set.size) {
      this.watchers.delete(w.key)
      this.cursors.delete(w.key)
    }
  }

  watching() {
    let n = 0
    for (const s of this.watchers.values()) n += s.size
    return n
  }

  /** Stops the loop (process shutdown); open feeds end with their server. */
  close() {
    this.closed = true
  }

  private async loop() {
    try {
      while (this.cursors.size && !this.closed) {
        const keys = [...this.cursors.keys()]
        const ids = keys.map((k) => this.cursors.get(k)!)
        let res: Array<{ name: string; messages: Array<RawEntry> }> | null
        try {
          res = (await this.redis.xRead(
            keys.map((key, i) => ({ key, id: ids[i]! })),
            { BLOCK: LIMITS.hubBlockMs },
          )) as Array<{ name: string; messages: Array<RawEntry> }> | null
        } catch (err) {
          if (this.isClosed()) break
          console.error('[runBus] reading session streams failed', err)
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        for (const { name: key, messages: items } of res ?? []) {
          for (const raw of items) {
            const e = toEntry(raw)
            if (this.cursors.has(key)) this.cursors.set(key, e.id)
            for (const w of this.watchers.get(key) ?? []) {
              if (idAfter(e.id, w.last)) {
                w.last = e.id
                w.push(e)
              }
            }
          }
        }
      }
    } finally {
      this.running = false
    }
  }
}

// ---- the process-wide instance ---------------------------------------------

/**
 * Connects in the background; commands sent meanwhile wait in the client's
 * queue. node-redis reconnects by itself, and an 'error' listener is
 * required, or a dropped connection would crash the process.
 */
function connect(client: Redis, name: string) {
  client.on('error', (err) => {
    console.error(`[runBus] Redis (${name})`, err)
  })
  client.connect().catch((err: unknown) => {
    console.error(`[runBus] connecting to Redis (${name}) failed`, err)
  })
  return client
}

let bus: RunBus | null | undefined

/** The process's RunBus, or null when REDIS_URL is unset (feature off). */
export function getRunBus(adk: () => AdkAccess): RunBus | null {
  if (bus !== undefined) return bus
  const url = process.env.REDIS_URL
  if (!url) return (bus = null)
  const redis = connect(createClient({ url }), 'commands')
  // XREAD BLOCK holds its connection; the hub gets one of its own.
  const hubRedis = connect(redis.duplicate(), 'stream reader')
  bus = new RunBus(redis, hubRedis, adk())
  const instance = bus
  // Nitro closes the server on SIGTERM and exits a few seconds later; stop
  // the runs first so their viewers get each run's end.
  process.once('SIGTERM', () => void instance.shutdown())
  return bus
}
