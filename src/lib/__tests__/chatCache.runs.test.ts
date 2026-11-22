import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  BUSY_NOTICE,
  INITIAL_CHAT_STATE,
  chatCacheKey,
  connectSessionEvents,
  isRunEndEvent,
  isTurnInterrupted,
  rebuildChatState,
  sendChatMessage,
  stopRun,
} from '../chatCache'
import type { ChatSessionState } from '../chatCache'
import type { AdkEvent } from '../adk'

// Background runs: one live feed per session (`/api/runs/:id/events`) brings
// the stored events, then every run as it happens. The client merges them:
// complete events by id, the run in progress from its replay.

const getSession = vi.fn()
vi.mock('../chatSessions.functions', () => ({
  getSession: (arg: unknown) => getSession(arg),
  listSessions: vi.fn(),
}))

let clock = 0
function ev(
  invocationId: string,
  role: 'user' | 'model',
  text: string,
  extra: Partial<AdkEvent> = {},
): AdkEvent {
  clock++
  return {
    id: `${invocationId}-${clock}`,
    timestamp: clock,
    invocationId,
    author: role === 'user' ? 'user' : 'writer',
    content: { role, parts: [{ text }] },
    ...extra,
  } as AdkEvent
}

const toolCall = (inv: string) =>
  ({
    invocationId: inv,
    author: 'writer',
    content: {
      role: 'model',
      parts: [{ functionCall: { id: 'c1', name: 'search', args: {} } }],
    },
  }) as unknown as AdkEvent

// Frames of the /events feed.
const hist = (e: AdkEvent) => `event: history\ndata: ${JSON.stringify(e)}\n\n`
const msg = (e: AdkEvent) => `data: ${JSON.stringify(e)}\n\n`
const end = (outcome = 'completed') => `event: end\ndata: ${outcome}\n\n`
const synced = (running: boolean) =>
  `event: synced\ndata: ${JSON.stringify({ running })}\n\n`

/** A feed response that stays open; frames are pushed in as the test goes. */
function openFeed() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    push: (...frames: Array<string>) =>
      controller.enqueue(encoder.encode(frames.join(''))),
    close: () => controller.close(),
  }
}

/** The old /api/run-sse body (background runs off). */
function sse(events: Array<AdkEvent>) {
  return new Response(events.map(msg).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

const texts = (s: ChatSessionState | undefined) =>
  s?.messages.map((m) => m.parts?.map((p) => p.text ?? '').join('')) ?? []

describe('end of a run', () => {
  test('the writer answer, or a stopped run, ends it', () => {
    expect(isRunEndEvent(ev('a', 'model', 'answer'))).toBe(true)
    expect(isRunEndEvent(ev('a', 'model', 'x', { partial: true }))).toBe(false)
    expect(isRunEndEvent(toolCall('a'))).toBe(false)
    expect(isRunEndEvent(ev('a', 'user', 'q'))).toBe(false)
    expect(
      isRunEndEvent({
        invocationId: 'a',
        author: 'writer',
        customMetadata: { cofacts_run_end: 'cancelled' },
      } as unknown as AdkEvent),
    ).toBe(true)
  })

  test('interrupted: no answer, unless the user stopped it', () => {
    const q = ev('a', 'user', 'q')
    expect(isTurnInterrupted([])).toBe(false)
    expect(isTurnInterrupted([q, ev('a', 'model', 'answer')])).toBe(false)
    expect(isTurnInterrupted([q])).toBe(true) // owner died
    expect(isTurnInterrupted([q, toolCall('a')])).toBe(true)
    const stopped = (how: string) =>
      ev('a', 'model', 'half', { customMetadata: { cofacts_run_end: how } })
    expect(isTurnInterrupted([q, stopped('interrupted')])).toBe(true)
    expect(isTurnInterrupted([q, stopped('cancelled')])).toBe(false)
    // Stopped through the old /run_sse.
    const aborted = {
      invocationId: 'a',
      author: 'writer',
      errorCode: 'INVOCATION_ABORTED',
    } as unknown as AdkEvent
    expect(isTurnInterrupted([q, aborted])).toBe(false)
    // A state-only write after the answer doesn't change anything.
    const stateOnly = { invocationId: 'p-1', author: 'user' } as AdkEvent
    expect(isTurnInterrupted([q, ev('a', 'model', 'ok'), stateOnly])).toBe(
      false,
    )
  })
})

describe('rebuildChatState', () => {
  test('the live run replaces its invocation in the history', () => {
    const history = [
      ev('old', 'user', 'q1'),
      ev('old', 'model', 'a1'),
      ev('cur', 'user', 'q2'), // already stored, also replayed by the stream
    ]
    const live = {
      invocationId: 'cur',
      events: [
        ev('cur', 'user', 'q2'),
        ev('cur', 'model', '部分', { partial: true }),
      ],
    }
    const s = rebuildChatState(INITIAL_CHAT_STATE, history, live)
    expect(texts(s)).toEqual(['q1', 'a1', 'q2', '部分'])
    expect(s.messages.at(-1)?.isStreaming).toBe(true)
    expect(s.interrupted).toBe(false)
  })

  test('message ids are positions, so a rebuild keeps them', () => {
    const history = [ev('a', 'user', 'q'), ev('a', 'model', 'x')]
    const s1 = rebuildChatState(INITIAL_CHAT_STATE, history, null)
    const s2 = rebuildChatState(s1, history, null)
    expect(s2.messages.map((m) => m.id)).toEqual(s1.messages.map((m) => m.id))
  })
})

describe('the session feed', () => {
  let qc: QueryClient
  const fetchMock = vi.fn()
  const closers: Array<() => void> = []
  const state = () => qc.getQueryData<ChatSessionState>(chatCacheKey('s'))
  const connect = () => closers.push(connectSessionEvents(qc, 's'))
  /** Routes fetches by URL; a feed URL takes the next queued feed. */
  function route(
    feedQueue: Array<Response>,
    handlers: Record<string, () => Promise<Response> | Response> = {},
  ) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/runs/s/events')) {
        const next = feedQueue.shift()
        if (next) return next
        return new Promise(() => {}) // no more feeds: hang until aborted
      }
      const handler = handlers[url]
      if (handler) return handler()
      throw new Error(`unexpected fetch ${url}`)
    })
  }

  beforeEach(() => {
    qc = new QueryClient()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    getSession.mockReset()
  })
  afterEach(() => {
    closers.splice(0).forEach((close) => close())
    vi.unstubAllGlobals()
  })

  test('joining mid-run: replay replaces the stored copy, end finishes it', async () => {
    const q = ev('cur', 'user', 'q')
    const answer = ev('cur', 'model', '一二')
    const feed = openFeed()
    route([feed.response])
    connect()
    feed.push(
      hist(q),
      msg(q),
      msg(ev('cur', 'model', '一', { partial: true })),
      msg(ev('cur', 'model', '二', { partial: true })),
      synced(true),
    )
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(true))
    expect(texts(state())).toEqual(['q', '一二'])
    expect(state()?.messages.at(-1)?.isStreaming).toBe(true)

    feed.push(msg(answer), end())
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['q', '一二'])
    expect(state()?.live).toBeNull()
    expect(state()?.historyEvents.map((e) => e.id)).toEqual([q.id, answer.id])
  })

  test('an idle feed shows a run started in another window', async () => {
    const feed = openFeed()
    route([feed.response])
    connect()
    feed.push(
      hist(ev('a', 'user', 'q1')),
      hist(ev('a', 'model', 'a1')),
      synced(false),
    )
    await vi.waitFor(() => expect(texts(state())).toEqual(['q1', 'a1']))
    expect(state()?.isStreaming).toBe(false)

    // Another window sends: its message comes first on this feed.
    feed.push(msg(ev('b', 'user', 'q2')))
    await vi.waitFor(() => expect(texts(state())).toEqual(['q1', 'a1', 'q2']))
    expect(state()?.isStreaming).toBe(true)
    feed.push(msg(ev('b', 'model', 'a2')), end())
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['q1', 'a1', 'q2', 'a2'])
  })

  test('reconnects with since and replays the run without duplicates', async () => {
    const q = ev('cur', 'user', 'q')
    const first = openFeed()
    const second = openFeed()
    route([first.response, second.response])
    connect()
    first.push(
      hist(q),
      msg(q),
      msg(ev('cur', 'model', '一', { partial: true })),
      synced(true),
    )
    await vi.waitFor(() => expect(texts(state())).toEqual(['q', '一']))
    first.close() // e.g. Cloud Run's request timeout

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/runs/s/events?since=${encodeURIComponent(q.id)}`,
    )
    second.push(
      synced(true),
      msg(q),
      msg(ev('cur', 'model', '一', { partial: true })),
      msg(ev('cur', 'model', '二', { partial: true })),
    )
    await vi.waitFor(() => expect(texts(state())).toEqual(['q', '一二']))
    second.push(msg(ev('cur', 'model', '一二')), end())
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['q', '一二'])
  })

  test('a run that ended while disconnected is not left streaming', async () => {
    const q = ev('cur', 'user', 'q')
    const answer = ev('cur', 'model', 'done')
    const first = openFeed()
    const second = openFeed()
    route([first.response, second.response])
    connect()
    first.push(
      hist(q),
      msg(q),
      msg(ev('cur', 'model', 'do', { partial: true })),
      synced(true),
    )
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(true))
    first.close()
    second.push(hist(answer), synced(false))
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['q', 'done'])
  })

  test('events caught up after the end land in time order', async () => {
    const q = ev('cur', 'user', 'q')
    const call = toolCall('cur')
    Object.assign(call, { id: 'call', timestamp: clock + 0.5 })
    const answer = ev('cur', 'model', 'answer')
    const feed = openFeed()
    route([feed.response])
    connect()
    // The tool call's batch never reached Redis; the end catches it up.
    feed.push(synced(false), msg(q), msg(answer), hist(call), end())
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(state()?.historyEvents.map((e) => e.id)).toEqual([
      q.id,
      'call',
      answer.id,
    ])
  })

  test('send: 202, and the feed replaces the optimistic message', async () => {
    const feed = openFeed()
    route([feed.response], {
      '/api/runs/s/start': () => json({ invocationId: 'cur' }, 202),
    })
    connect()
    feed.push(synced(false))
    expect(await sendChatMessage(qc, 's', 'hello')).toBe(true)
    expect(texts(state())).toEqual(['hello'])
    feed.push(
      msg(ev('cur', 'user', 'hello')),
      msg(ev('cur', 'model', 'answer')),
      end(),
    )
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['hello', 'answer'])
  })

  test('send: 409 hands the draft back; the feed shows the other run', async () => {
    const feed = openFeed()
    route([feed.response], {
      '/api/runs/s/start': () => json({ invocationId: 'other' }, 409),
    })
    connect()
    feed.push(synced(true), msg(ev('other', 'user', 'theirs')))
    await vi.waitFor(() => expect(texts(state())).toEqual(['theirs']))
    expect(await sendChatMessage(qc, 's', 'mine')).toBe(false)
    expect(texts(state())).toEqual(['theirs'])
    expect(state()?.notice).toBe(BUSY_NOTICE)
  })

  test('the feed saying "not running" leaves a send in flight alone', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>((r) => (releaseStart = r))
    const feed = openFeed()
    route([feed.response], {
      '/api/runs/s/start': async () => {
        await startGate
        return json({ invocationId: 'cur' }, 202)
      },
    })
    const sent = sendChatMessage(qc, 's', 'hello')
    connect() // the session page mounts after the landing page's send
    feed.push(synced(false))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 10))
    expect(texts(state())).toEqual(['hello'])
    expect(state()?.isStreaming).toBe(true)
    releaseStart()
    expect(await sent).toBe(true)
  })

  test('stop pressed while the start request is in flight cancels the run', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>((r) => (releaseStart = r))
    route([], {
      '/api/runs/s/start': async () => {
        await startGate
        return json({ invocationId: 'cur' }, 202)
      },
      '/api/runs/s/cancel': () => json({}, 202),
    })
    const sent = sendChatMessage(qc, 's', 'hello')
    await stopRun('s') // no lock yet: remembered, not sent
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/runs/s/start'])
    releaseStart()
    await sent
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(
      '/api/runs/s/cancel',
    )
  })

  test('503 while ADK shuts down is an error, not a fallback to /run_sse', async () => {
    route([], {
      '/api/runs/s/start': () =>
        json({ detail: { reason: 'shutting_down' } }, 503),
    })
    await sendChatMessage(qc, 's', 'hello')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/runs/s/start'])
    expect(state()?.isStreaming).toBe(false)
    expect(state()?.error).toMatch(/503/)
  })

  test('background runs off: history loads once, sends use /api/run-sse', async () => {
    getSession.mockResolvedValue({
      events: [ev('a', 'user', 'old')],
      state: {},
    })
    route([json({ detail: { reason: 'disabled' } }, 503)], {
      '/api/runs/s/start': () => json({ detail: { reason: 'disabled' } }, 503),
      '/api/run-sse': () => sse([ev('x', 'model', 'answer')]),
    })
    connect()
    await vi.waitFor(() => expect(texts(state())).toEqual(['old']))
    await sendChatMessage(qc, 's', 'hello')
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['old', 'hello', 'answer'])
    expect(
      fetchMock.mock.calls.filter((c) => c[0].startsWith('/api/runs/s/events')),
    ).toHaveLength(1)
  })
  test('409 after the other run already ended leaves the page idle', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>((r) => (releaseStart = r))
    const feed = openFeed()
    route([feed.response], {
      '/api/runs/s/start': async () => {
        await startGate
        return json({ invocationId: 'other' }, 409)
      },
    })
    connect()
    feed.push(synced(true), msg(ev('other', 'user', 'theirs')))
    await vi.waitFor(() => expect(texts(state())).toEqual(['theirs']))
    const sent = sendChatMessage(qc, 's', 'mine')
    // The other run ends while this send's request is still out.
    feed.push(msg(ev('other', 'model', 'done')), end())
    await vi.waitFor(() => expect(state()?.live).toBeNull())
    releaseStart()
    expect(await sent).toBe(false)
    expect(state()?.isStreaming).toBe(false)
    expect(state()?.notice).toBe(BUSY_NOTICE)
  })

  test('no Redis: the history load leaves a send in flight alone', async () => {
    let releaseStart!: () => void
    const startGate = new Promise<void>((r) => (releaseStart = r))
    getSession.mockResolvedValue({ events: [], state: {} })
    route([json({ detail: { reason: 'disabled' } }, 503)], {
      '/api/runs/s/start': async () => {
        await startGate
        return json({ detail: { reason: 'disabled' } }, 503)
      },
      '/api/run-sse': () => sse([ev('x', 'model', 'answer')]),
    })
    const sent = sendChatMessage(qc, 's', 'hello') // landing page's send
    connect() // then the session page mounts
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => c[0].startsWith('/api/runs/s/events')),
      ).toBe(true),
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(getSession).not.toHaveBeenCalled()
    expect(texts(state())).toEqual(['hello'])
    expect(state()?.isStreaming).toBe(true)
    releaseStart()
    await sent
    await vi.waitFor(() => expect(state()?.isStreaming).toBe(false))
    expect(texts(state())).toEqual(['hello', 'answer'])
  })

  test('an attachment that fails to read gives the draft back', async () => {
    route([])
    const OriginalReader = globalThis.FileReader
    class FailingReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      error = new Error('read failed')
      readAsDataURL() {
        setTimeout(() => this.onerror?.())
      }
    }
    vi.stubGlobal('FileReader', FailingReader)
    try {
      const file = new File(['x'], 'a.png', { type: 'image/png' })
      expect(await sendChatMessage(qc, 's', 'hi', [file])).toBe(false)
    } finally {
      vi.stubGlobal('FileReader', OriginalReader)
    }
    expect(state()?.isStreaming).toBe(false)
    expect(state()?.error).toMatch(/read failed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('a burst of stored events rebuilds the screen once', async () => {
    const feed = openFeed()
    route([feed.response])
    const writes = vi.spyOn(qc, 'setQueryData')
    connect()
    const events = Array.from({ length: 50 }, (_, i) =>
      ev('h', i % 2 ? 'model' : 'user', `m${i}`),
    )
    feed.push(...events.map(hist), synced(false))
    await vi.waitFor(() => expect(state()?.historyEvents).toHaveLength(50))
    // One write for the history, one for `synced`.
    expect(writes.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
