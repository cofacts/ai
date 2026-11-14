import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  BUSY_NOTICE,
  INITIAL_CHAT_STATE,
  abortControllers,
  chatCacheKey,
  isRunEndEvent,
  isTurnInterrupted,
  rebuildChatState,
  sendChatMessage,
  watchRun,
} from '../chatCache'
import type { ChatSessionState } from '../chatCache'
import type { AdkEvent } from '../adk'

// Background runs: the client merges the session history with the stream of
// the run in progress (which always replays from the run's first event), and
// decides from the last event whether a closed stream means the run ended.

const getSession = vi.fn()
vi.mock('../chatSessions.functions', () => ({
  getSession: (arg: unknown) => getSession(arg),
  listSessions: vi.fn(),
}))

function ev(
  invocationId: string,
  role: 'user' | 'model',
  text: string,
  extra: Partial<AdkEvent> = {},
): AdkEvent {
  return {
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

function sse(events: Array<AdkEvent>) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(body, {
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
    const end = (how: string) =>
      ev('a', 'model', 'half', { customMetadata: { cofacts_run_end: how } })
    expect(isTurnInterrupted([q, end('interrupted')])).toBe(true)
    expect(isTurnInterrupted([q, end('cancelled')])).toBe(false)
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

describe('watching and starting runs', () => {
  let qc: QueryClient
  const fetchMock = vi.fn()

  beforeEach(() => {
    qc = new QueryClient()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    getSession.mockReset()
    abortControllers.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('joining mid-run: replay replaces the history copy, answer ends it', async () => {
    qc.setQueryData(
      chatCacheKey('s'),
      rebuildChatState(INITIAL_CHAT_STATE, [ev('cur', 'user', 'q')], null),
    )
    fetchMock.mockResolvedValueOnce(
      sse([
        ev('cur', 'user', 'q'),
        ev('cur', 'model', '一', { partial: true }),
        ev('cur', 'model', '二', { partial: true }),
        ev('cur', 'model', '一二'),
      ]),
    )
    await watchRun(qc, 's')

    const s = qc.getQueryData<ChatSessionState>(chatCacheKey('s'))
    expect(texts(s)).toEqual(['q', '一二'])
    expect(s?.isStreaming).toBe(false)
    expect(s?.live).toBeNull()
    expect(s?.historyEvents.map((e) => e.invocationId)).toEqual(['cur', 'cur'])
    expect(fetchMock).toHaveBeenCalledTimes(1) // no status check needed
    expect(abortControllers.has('s')).toBe(false)
  })

  test('a dropped connection with the run still going reattaches', async () => {
    fetchMock
      .mockResolvedValueOnce(
        sse([
          ev('cur', 'user', 'q'),
          ev('cur', 'model', '一', { partial: true }),
        ]),
      )
      .mockResolvedValueOnce(json({ running: true, invocationId: 'cur' }))
      .mockResolvedValueOnce(
        sse([
          ev('cur', 'user', 'q'),
          ev('cur', 'model', '一', { partial: true }),
          ev('cur', 'model', '二', { partial: true }),
          ev('cur', 'model', '一二'),
        ]),
      )
    await watchRun(qc, 's')
    const s = qc.getQueryData<ChatSessionState>(chatCacheKey('s'))
    expect(texts(s)).toEqual(['q', '一二']) // replayed, not duplicated
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/runs/s/stream',
      '/api/runs/s/status',
      '/api/runs/s/stream',
    ])
  })

  test('closed mid-run with no run left: reload the history', async () => {
    fetchMock
      .mockResolvedValueOnce(sse([ev('cur', 'user', 'q'), toolCall('cur')]))
      .mockResolvedValueOnce(json({ running: false, invocationId: null }))
    getSession.mockResolvedValueOnce({
      events: [ev('cur', 'user', 'q')],
      state: {},
    })

    await watchRun(qc, 's')
    const s = qc.getQueryData<ChatSessionState>(chatCacheKey('s'))
    expect(texts(s)).toEqual(['q'])
    expect(s?.interrupted).toBe(true)
    expect(s?.isStreaming).toBe(false)
  })

  test('send: 202 then watch; the optimistic message is replaced', async () => {
    getSession.mockResolvedValue({ events: [], state: {} })
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/runs/s/start')
        return Promise.resolve(json({ invocationId: 'cur' }, 202))
      if (url === '/api/runs/s/stream')
        return Promise.resolve(
          sse([ev('cur', 'user', 'hello'), ev('cur', 'model', 'answer')]),
        )
      return Promise.reject(new Error(url))
    })
    expect(await sendChatMessage(qc, 's', 'hello')).toBe(true)
    await vi.waitFor(() =>
      expect(
        qc.getQueryData<ChatSessionState>(chatCacheKey('s'))?.isStreaming,
      ).toBe(false),
    )
    expect(texts(qc.getQueryData(chatCacheKey('s')))).toEqual([
      'hello',
      'answer',
    ])
  })

  test('send: 409 hands the draft back and watches the other run', async () => {
    qc.setQueryData(chatCacheKey('s'), INITIAL_CHAT_STATE)
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/runs/s/start')
        return Promise.resolve(json({ invocationId: 'other' }, 409))
      if (url === '/api/runs/s/stream')
        return Promise.resolve(
          sse([ev('other', 'user', 'theirs'), ev('other', 'model', 'done')]),
        )
      return Promise.reject(new Error(url))
    })
    expect(await sendChatMessage(qc, 's', 'mine')).toBe(false)
    await vi.waitFor(() =>
      expect(texts(qc.getQueryData(chatCacheKey('s')))).toEqual([
        'theirs',
        'done',
      ]),
    )
    expect(qc.getQueryData<ChatSessionState>(chatCacheKey('s'))?.notice).toBe(
      BUSY_NOTICE,
    )
  })
})
