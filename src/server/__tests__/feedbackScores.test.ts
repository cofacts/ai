import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  fetchFeedbackForTrace,
  postFeedbackForTrace,
} from '../feedbackScores.functions'

const originalFetch = global.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.LANGFUSE_BASE_URL = 'https://langfuse.example.test'
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-test'
  process.env.LANGFUSE_SECRET_KEY = 'sk-test'
})

afterEach(() => {
  vi.clearAllMocks()
  global.fetch = originalFetch
  process.env = { ...originalEnv }
})

function mockFetchOnce(response: Partial<Response> & { jsonBody?: unknown }) {
  const fn = vi.fn(() =>
    Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      statusText: response.statusText ?? 'OK',
      json: () => Promise.resolve(response.jsonBody ?? { data: [] }),
    }),
  ) as unknown as typeof fetch
  global.fetch = fn
  return fn as unknown as ReturnType<typeof vi.fn>
}

describe('fetchFeedbackForTrace', () => {
  test('returns null score when Langfuse env vars are missing', async () => {
    delete process.env.LANGFUSE_BASE_URL
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    const result = await fetchFeedbackForTrace('trace-1', 'user-1')

    expect(result).toEqual({ value: null, comment: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('filters by trace.userId via query params and sends Basic auth header', async () => {
    const fetchSpy = mockFetchOnce({ jsonBody: { data: [] } })

    await fetchFeedbackForTrace('trace-abc', 'user-42')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [URL, RequestInit]
    expect(calledUrl.origin).toBe('https://langfuse.example.test')
    expect(calledUrl.pathname).toBe('/api/public/v2/scores')
    expect(calledUrl.searchParams.get('traceId')).toBe('trace-abc')
    expect(calledUrl.searchParams.get('name')).toBe('user-thumbs')
    expect(calledUrl.searchParams.get('userId')).toBe('user-42')
    expect(calledUrl.searchParams.get('fields')).toBe('scores,trace')
    expect(calledUrl.searchParams.get('filter')).toBeNull()
    const auth = (init.headers as Record<string, string>).Authorization
    expect(auth).toBe(
      `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
    )
  })

  test('returns null score when Langfuse has no matching scores', async () => {
    mockFetchOnce({ jsonBody: { data: [] } })

    const result = await fetchFeedbackForTrace('trace-1', 'user-1')

    expect(result).toEqual({ value: null, comment: null })
  })

  test('returns thumbs-up with comment from latest score', async () => {
    mockFetchOnce({
      jsonBody: {
        data: [
          {
            id: 'user-trace-1',
            name: 'user-thumbs',
            value: 1,
            comment: 'helpful',
            updatedAt: '2026-01-02T00:00:00Z',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
    })

    const result = await fetchFeedbackForTrace('trace-1', 'user-1')

    expect(result).toEqual({ value: 1, comment: 'helpful' })
  })

  test('maps cleared score (value 0) to null so the UI shows no selection', async () => {
    mockFetchOnce({
      jsonBody: {
        data: [
          {
            id: 'user-trace-1',
            name: 'user-thumbs',
            value: 0,
            comment: '',
            updatedAt: '2026-01-02T00:00:00Z',
          },
        ],
      },
    })

    const result = await fetchFeedbackForTrace('trace-1', 'user-1')

    expect(result).toEqual({ value: null, comment: '' })
  })

  test('picks the most recently updated score when multiple are returned', async () => {
    mockFetchOnce({
      jsonBody: {
        data: [
          {
            id: 'a',
            name: 'user-thumbs',
            value: 1,
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'b',
            name: 'user-thumbs',
            value: -1,
            updatedAt: '2026-01-03T00:00:00Z',
          },
          {
            id: 'c',
            name: 'user-thumbs',
            value: 1,
            updatedAt: '2026-01-02T00:00:00Z',
          },
        ],
      },
    })

    const result = await fetchFeedbackForTrace('trace-1', 'user-1')

    expect(result.value).toBe(-1)
  })

  test('throws an Error with langfuse upstream message on failure', async () => {
    mockFetchOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })

    await expect(
      fetchFeedbackForTrace('trace-1', 'user-1'),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        err.message === 'Langfuse upstream failed: 503 Service Unavailable',
    )
  })
})

describe('postFeedbackForTrace', () => {
  test('no-ops when Langfuse env vars are missing', async () => {
    delete process.env.LANGFUSE_BASE_URL
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch

    await postFeedbackForTrace({ traceId: 'trace-1', value: 1 })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('POSTs deterministic id, NUMERIC dataType, and Basic auth header', async () => {
    const fetchSpy = mockFetchOnce({ jsonBody: { id: 'user-trace-1' } })

    await postFeedbackForTrace({
      traceId: 'trace-1',
      value: 1,
      comment: 'helpful',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [URL, RequestInit]
    expect(calledUrl.pathname).toBe('/api/public/v2/scores')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
    )
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      id: 'user-trace-1',
      traceId: 'trace-1',
      name: 'user-thumbs',
      value: 1,
      dataType: 'NUMERIC',
      comment: 'helpful',
    })
  })

  test('omits comment field when not provided so prior comment is preserved on toggle', async () => {
    const fetchSpy = mockFetchOnce({ jsonBody: {} })

    await postFeedbackForTrace({ traceId: 'trace-1', value: -1 })

    const [, init] = fetchSpy.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).not.toHaveProperty('comment')
    expect(body.value).toBe(-1)
  })

  test('sends value 0 to clear feedback', async () => {
    const fetchSpy = mockFetchOnce({ jsonBody: {} })

    await postFeedbackForTrace({
      traceId: 'trace-1',
      value: 0,
      comment: '',
    })

    const [, init] = fetchSpy.mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.value).toBe(0)
    expect(body.comment).toBe('')
  })

  test('throws an Error with langfuse upstream message on failure', async () => {
    mockFetchOnce({ ok: false, status: 500, statusText: 'Server Error' })

    await expect(
      postFeedbackForTrace({ traceId: 'trace-1', value: 1 }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        err.message === 'Langfuse upstream failed: 500 Server Error',
    )
  })
})
