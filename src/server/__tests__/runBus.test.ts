import Redis from 'ioredis'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'
import {
  AdkRunError,
  LIMITS,
  RunBus,
  RunBusUnavailable,
  cancelKey,
  lockKey,
  streamKey,
} from '../runBus'
import type { AdkAccess, StoredEvent } from '../runBus'

// Background runs run from the BFF (runBus.ts), against a real Redis
// (TEST_REDIS_URL; CI provides one) and a fake ADK: /run_sse streams scripted
// frames and stores complete events, like ADK does, and stops when its
// request is aborted (storing ADK's INVOCATION_ABORTED marker).

const REDIS_URL = process.env.TEST_REDIS_URL
const USER = 'u1'
const SID = 's1'

type Step = { delay: number; event: (inv: string) => StoredEvent }

let clock = 0
function textEvent(inv: string, text: string, partial: boolean): StoredEvent {
  clock++
  return {
    id: `${inv}-${clock}`,
    invocationId: inv,
    author: 'writer',
    partial,
    timestamp: clock,
    content: { role: 'model', parts: [{ text }] } as StoredEvent['content'],
  }
}

function answer(n = 3, delay = 20): Array<Step> {
  const steps: Array<Step> = Array.from({ length: n }, (_, i) => ({
    delay,
    event: (inv) => textEvent(inv, `p${i}`, true),
  }))
  steps.push({
    delay,
    event: (inv) =>
      textEvent(
        inv,
        Array.from({ length: n }, (_, i) => `p${i}`).join(''),
        false,
      ),
  })
  return steps
}

/** A fake ADK: a session store and a scripted /run_sse. */
class FakeAdk implements AdkAccess {
  sessions = new Map<string, Array<StoredEvent>>([[SID, []]])
  state: Record<string, unknown> = {}
  calls = 0
  constructor(
    public script: Array<Step>,
    public inv = 'e-1',
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- a fake fetch
  runSse: AdkAccess['runSse'] = async ({ sessionId, newMessage, signal }) => {
    this.calls++
    const store = this.sessions.get(sessionId)
    if (!store)
      return new Response('{"detail":"Session not found"}', { status: 404 })
    const inv = this.inv
    clock++
    store.push({
      id: `${inv}-user-${clock}`,
      invocationId: inv,
      author: 'user',
      timestamp: clock,
      content: newMessage as StoredEvent['content'],
    })
    const script = this.script
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const abort = () => {
          clock++
          store.push({
            id: `${inv}-aborted-${clock}`,
            invocationId: inv,
            author: 'writer',
            timestamp: clock,
            errorCode: 'INVOCATION_ABORTED',
          } as StoredEvent)
          controller.error(new DOMException('aborted', 'AbortError'))
        }
        signal.addEventListener('abort', abort, { once: true })
        for (const step of script) {
          await new Promise((r) => setTimeout(r, step.delay))
          if (signal.aborted) return
          const ev = step.event(inv)
          if (!ev.partial) store.push(ev)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
        }
        signal.removeEventListener('abort', abort)
        controller.close()
      },
    })
    return new Response(body, { status: 200 })
  }

  sessionEvents: AdkAccess['sessionEvents'] = (_u, sessionId) =>
    Promise.resolve(this.sessions.get(sessionId)?.slice() ?? null)

  patchState: AdkAccess['patchState'] = (_u, _s, delta) => {
    Object.assign(this.state, delta)
    return Promise.resolve()
  }
}

type Frame = [kind: string, payload: any]

function parse(text: string): Array<Frame> {
  const out: Array<Frame> = []
  for (const part of text.split('\n\n')) {
    if (!part) continue
    if (part.startsWith(': heartbeat')) {
      out.push(['heartbeat', null])
      continue
    }
    let kind = 'data'
    let data = ''
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) kind = line.slice(7)
      else if (line.startsWith('data: ')) data = line.slice(6)
    }
    out.push([kind, kind === 'end' ? data : JSON.parse(data)])
  }
  return out
}

/** Reads an open feed until pred(frames) holds. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pred: (f: Array<Frame>) => boolean,
  timeout = 5000,
) {
  const decoder = new TextDecoder()
  const frames: Array<Frame> = []
  let buf = ''
  const deadline = Date.now() + timeout
  while (!pred(frames)) {
    if (Date.now() > deadline)
      throw new Error(`timeout; got ${JSON.stringify(frames)}`)
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const cut = buf.lastIndexOf('\n\n')
    if (cut >= 0) {
      frames.push(...parse(buf.slice(0, cut + 2)))
      buf = buf.slice(cut + 2)
    }
  }
  return frames
}

const ends = (f: Array<Frame>) =>
  f.filter(([k]) => k === 'end').map(([, p]) => p)
const synced = (f: Array<Frame>) => f.some(([k]) => k === 'synced')
const datas = (f: Array<Frame>) =>
  f.filter(([k]) => k === 'data').map(([, p]) => p)
const text = (p: any) => p.content?.parts?.[0]?.text

describe.skipIf(!REDIS_URL)('RunBus (BFF background runs)', () => {
  let redis: Redis
  const buses: Array<RunBus> = []
  const extra: Array<Redis> = []
  const saved = { ...LIMITS }

  function makeBus(adk: FakeAdk) {
    const hub = new Redis(REDIS_URL!)
    extra.push(hub)
    const bus = new RunBus(redis, hub, adk)
    buses.push(bus)
    return bus
  }

  async function open(bus: RunBus, since: string | null = null) {
    const ac = new AbortController()
    const body = await bus.openEvents(USER, SID, since, ac.signal)
    const reader = body.getReader()
    return {
      reader,
      close: async () => {
        ac.abort()
        await reader.cancel().catch(() => {})
      },
    }
  }

  async function idle(bus: RunBus, timeout = 5000) {
    const deadline = Date.now() + timeout
    while (bus.runningCount()) {
      if (Date.now() > deadline) throw new Error('run did not finish')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  const msg = (t = 'hi') => ({ role: 'user', parts: [{ text: t }] })

  beforeAll(() => {
    redis = new Redis(REDIS_URL!)
  })
  afterAll(async () => {
    await redis.quit()
  })
  beforeEach(async () => {
    await redis.flushdb()
    Object.assign(LIMITS, {
      writeBatchMs: 5,
      cancelPollMs: 20,
      feedBlockMs: 300,
      hubBlockMs: 100,
    })
  })
  afterEach(async () => {
    Object.assign(LIMITS, saved)
    for (const bus of buses.splice(0)) await bus.shutdown()
    for (const r of extra.splice(0)) r.disconnect()
  })

  test('a run completes with no viewer and releases its lock', async () => {
    const adk = new FakeAdk(answer())
    const bus = makeBus(adk)
    expect(
      await bus.start({
        userId: USER,
        sessionId: SID,
        newMessage: msg(),
        token: 't',
      }),
    ).toEqual({ started: true })
    await idle(bus)
    expect(await redis.get(lockKey(USER, SID))).toBeNull()
    expect(adk.sessions.get(SID)!.map((e) => text(e) ?? e.author)).toEqual([
      'hi',
      'p0p1p2',
    ])
    const ttl = await redis.ttl(streamKey(USER, SID))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30)
  })

  test('a feed shows the stored question first, then the run, then its end', async () => {
    const bus = makeBus(new FakeAdk(answer()))
    const feed = await open(bus)
    expect((await readUntil(feed.reader, synced)).at(-1)).toEqual([
      'synced',
      { running: false },
    ])
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    const frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
    await feed.close()
    expect(datas(frames).map(text)).toEqual(['hi', 'p0', 'p1', 'p2', 'p0p1p2'])
    expect(ends(frames)).toEqual(['completed'])
  })

  test('a late feed gets the run so far, then live', async () => {
    const steps: Array<Step> = [
      { delay: 10, event: (inv) => textEvent(inv, 'a', true) },
      { delay: 10, event: (inv) => textEvent(inv, 'b', true) },
      { delay: 300, event: (inv) => textEvent(inv, 'c', true) },
      { delay: 10, event: (inv) => textEvent(inv, 'abc', false) },
    ]
    const bus = makeBus(new FakeAdk(steps))
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    await new Promise((r) => setTimeout(r, 150))
    const feed = await open(bus)
    const frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
    await feed.close()
    expect(
      frames.filter(([k]) => k === 'history').map(([, p]) => text(p)),
    ).toEqual(['hi'])
    expect(datas(frames).map(text)).toEqual(['hi', 'a', 'b', 'c', 'abc'])
  })

  test('closing a feed does not stop the run', async () => {
    const adk = new FakeAdk(answer(3, 50))
    const bus = makeBus(adk)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    const feed = await open(bus)
    await readUntil(feed.reader, synced)
    await feed.close()
    await idle(bus)
    expect(adk.sessions.get(SID)!.at(-1)).toMatchObject({ partial: false })
    expect(text(adk.sessions.get(SID)!.at(-1))).toBe('p0p1p2')
  })

  test('a second start on a busy session is refused', async () => {
    const adk = new FakeAdk(answer(3, 50))
    const bus = makeBus(adk)
    const other = makeBus(adk)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    expect(
      await other.start({
        userId: USER,
        sessionId: SID,
        newMessage: msg('2'),
        token: 't',
      }),
    ).toEqual({ started: false })
    expect(adk.calls).toBe(1)
    await idle(bus)
  })

  test('cancel on the owner aborts the run and ends it as cancelled', async () => {
    const adk = new FakeAdk([
      { delay: 10, event: (inv) => textEvent(inv, 'half', true) },
      { delay: 5000, event: (inv) => textEvent(inv, 'never', false) },
    ])
    const bus = makeBus(adk)
    const feed = await open(bus)
    await readUntil(feed.reader, synced)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    await readUntil(feed.reader, (f) =>
      datas(f).some((p) => text(p) === 'half'),
    )
    expect(await bus.cancel(USER, SID)).toBe(true)
    const frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
    await feed.close()
    await idle(bus)
    expect(ends(frames)).toEqual(['cancelled'])
    // ADK's abort marker comes with the end, from the session store.
    expect(
      frames.find(
        ([k, p]) => k === 'history' && p.errorCode === 'INVOCATION_ABORTED',
      ),
    ).toBeTruthy()
    expect(await redis.get(lockKey(USER, SID))).toBeNull()
  })

  test('cancel from another process goes through Redis', async () => {
    const adk = new FakeAdk([
      { delay: 10, event: (inv) => textEvent(inv, 'x', true) },
      { delay: 5000, event: (inv) => textEvent(inv, 'never', false) },
    ])
    const owner = makeBus(adk)
    await owner.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    const other = makeBus(adk)
    expect(await other.cancel(USER, SID)).toBe(true)
    await idle(owner)
    expect(await redis.get(cancelKey(USER, SID))).toBeNull()
    expect(adk.sessions.get(SID)!.at(-1)).toMatchObject({
      errorCode: 'INVOCATION_ABORTED',
    })
  })

  test('cancel with no run is false', async () => {
    expect(await makeBus(new FakeAdk([])).cancel(USER, SID)).toBe(false)
  })

  test('one feed carries run after run, from any process', async () => {
    const bus = makeBus(new FakeAdk(answer(), 'e-1'))
    const feed = await open(bus)
    await readUntil(feed.reader, synced)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg('one'),
      token: 't',
    })
    let frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
    expect(new Set(datas(frames).map((p) => p.invocationId))).toEqual(
      new Set(['e-1']),
    )

    await idle(bus) // its lock is released just after its end is sent
    const adk2 = new FakeAdk(answer(), 'e-2')
    adk2.sessions = (bus.adk as FakeAdk).sessions
    const other = makeBus(adk2)
    await other.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg('two'),
      token: 't',
    })
    frames = await readUntil(feed.reader, (f) => ends(f).length === 1, 3000)
    await feed.close()
    expect(text(datas(frames)[0])).toBe('two')
    expect(new Set(datas(frames).map((p) => p.invocationId))).toEqual(
      new Set(['e-2']),
    )
    await idle(other)
  })

  test('a feed sends only stored events after `since`', async () => {
    const adk = new FakeAdk(answer())
    const bus = makeBus(adk)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    await idle(bus)
    const stored = adk.sessions.get(SID)!
    const feed = await open(bus, stored[0]!.id)
    const frames = await readUntil(feed.reader, synced)
    await feed.close()
    expect(
      frames.filter(([k]) => k === 'history').map(([, p]) => p.id),
    ).toEqual(stored.slice(1).map((e) => e.id))
  })

  test("a run's end catches up what the stream missed", async () => {
    const bus = makeBus(new FakeAdk(answer(3, 30)))
    const feed = await open(bus)
    await readUntil(feed.reader, synced)
    const realPipeline = redis.pipeline.bind(redis)
    redis.pipeline = ((...a: Parameters<typeof redis.pipeline>) => {
      const pipe = realPipeline(...a)
      const xadd = pipe.xadd.bind(pipe)
      pipe.xadd = ((...args: Array<any>) =>
        args.some((x) => typeof x === 'string' && x.includes('p0p1p2')) &&
        args.includes('0')
          ? pipe
          : xadd(...(args as [any]))) as typeof pipe.xadd
      return pipe
    }) as typeof redis.pipeline
    try {
      await bus.start({
        userId: USER,
        sessionId: SID,
        newMessage: msg(),
        token: 't',
      })
      const frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
      expect(
        datas(frames).some((p) => !p.partial && text(p) === 'p0p1p2'),
      ).toBe(false)
      const endAt = frames.findIndex(([k]) => k === 'end')
      expect(
        frames
          .slice(0, endAt)
          .filter(([k]) => k === 'history')
          .map(([, p]) => text(p)),
      ).toContain('p0p1p2')
    } finally {
      redis.pipeline = realPipeline
      await feed.close()
    }
  })

  test('a feed joining behind the hub still gets every entry', async () => {
    const steps: Array<Step> = Array.from({ length: 6 }, (_, i) => ({
      delay: 40,
      event: (inv: string) => textEvent(inv, `p${i}`, true),
    }))
    steps.push({
      delay: 40,
      event: (inv) => textEvent(inv, 'p0p1p2p3p4p5', false),
    })
    const bus = makeBus(new FakeAdk(steps))
    const first = await open(bus)
    await readUntil(first.reader, synced)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    await readUntil(first.reader, (f) => datas(f).length >= 4)
    // The second feed's own read saw only the first entry.
    const realXrange = redis.xrange.bind(redis)
    let calls = 0
    redis.xrange = (async (...a: Parameters<typeof redis.xrange>) => {
      calls++
      const rows = await realXrange(...a)
      return calls === 1 ? rows.slice(0, 1) : rows
    }) as typeof redis.xrange
    try {
      const second = await open(bus)
      const frames = await readUntil(second.reader, (f) => ends(f).length === 1)
      await second.close()
      expect(datas(frames).map(text)).toEqual([
        'hi',
        'p0',
        'p1',
        'p2',
        'p3',
        'p4',
        'p5',
        'p0p1p2p3p4p5',
      ])
    } finally {
      redis.xrange = realXrange
      await first.close()
    }
  })

  test('state writes wait for no run but defer for one', async () => {
    const adk = new FakeAdk(answer(3, 50))
    const bus = makeBus(adk)
    await redis.set(
      lockKey(USER, SID),
      JSON.stringify({ stateWrite: 'other' }),
      'PX',
      5000,
    )
    setTimeout(() => void redis.del(lockKey(USER, SID)), 150)
    expect(await bus.writeState(USER, SID, { title: 'x' })).toBe(false)
    expect(adk.state.title).toBe('x')

    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    expect(await bus.writeState(USER, SID, { title: 'y' })).toBe(true)
    expect(adk.state.title).toBe('x')
    await idle(bus)
  })

  test('shutdown interrupts runs and refuses new ones', async () => {
    const adk = new FakeAdk([
      { delay: 10, event: (inv) => textEvent(inv, 'x', true) },
      { delay: 5000, event: (inv) => textEvent(inv, 'never', false) },
    ])
    const bus = makeBus(adk)
    const feed = await open(bus)
    await readUntil(feed.reader, synced)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    await readUntil(feed.reader, (f) => datas(f).length >= 2)
    await bus.shutdown()
    const frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
    await feed.close()
    expect(ends(frames)).toEqual(['interrupted'])
    await expect(
      bus.start({
        userId: USER,
        sessionId: SID,
        newMessage: msg(),
        token: 't',
      }),
    ).rejects.toBeInstanceOf(RunBusUnavailable)
  })

  test('ADK refusing the run releases the lock', async () => {
    const adk = new FakeAdk(answer())
    adk.sessions.delete(SID)
    const bus = makeBus(adk)
    await expect(
      bus.start({
        userId: USER,
        sessionId: SID,
        newMessage: msg(),
        token: 't',
      }),
    ).rejects.toBeInstanceOf(AdkRunError)
    expect(await redis.get(lockKey(USER, SID))).toBeNull()
  })

  test('a feed ends a run whose owner died', async () => {
    const adk = new FakeAdk([
      { delay: 10, event: (inv) => textEvent(inv, 'x', true) },
      { delay: 60_000, event: (inv) => textEvent(inv, 'never', false) },
    ])
    const bus = makeBus(adk)
    const feed = await open(bus)
    await readUntil(feed.reader, synced)
    await bus.start({
      userId: USER,
      sessionId: SID,
      newMessage: msg(),
      token: 't',
    })
    await readUntil(feed.reader, (f) => datas(f).length >= 2)
    await redis.del(lockKey(USER, SID)) // its lock expired
    const frames = await readUntil(feed.reader, (f) => ends(f).length === 1)
    await feed.close()
    expect(ends(frames)).toEqual(['interrupted'])
  })

  test('idle feeds share one hub loop', async () => {
    const adk = new FakeAdk([])
    adk.sessions.set('s2', [])
    const bus = makeBus(adk)
    const feeds = []
    for (const sid of [SID, 's2', SID]) {
      const ac = new AbortController()
      const reader = (
        await bus.openEvents(USER, sid, null, ac.signal)
      ).getReader()
      await readUntil(reader, synced)
      const pending = reader.read()
      feeds.push({ ac, reader, pending })
    }
    await new Promise((r) => setTimeout(r, 50))
    expect(bus.hub.watching()).toBe(3)
    for (const f of feeds) {
      f.ac.abort()
      await f.reader.cancel().catch(() => {})
    }
  })
})
