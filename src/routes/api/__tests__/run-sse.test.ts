import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { HEARTBEAT_CHUNK, withHeartbeat } from '../run-sse'

// Cloudflare's browser-facing proxy force-closes a connection after 125s
// without a byte from the origin (see the comment above withHeartbeat in
// ../run-sse.ts). These tests exercise the wrapper in isolation, with a
// controllable upstream stream and fake timers standing in for real network
// delay.

function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let cancelReason: unknown
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel(reason) {
      cancelled = true
      cancelReason = reason
    },
  })
  return {
    stream,
    controller,
    wasCancelledWith: () => (cancelled ? cancelReason : undefined),
  }
}

const encoder = new TextEncoder()

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withHeartbeat', () => {
  test('passes real chunks through unchanged when they arrive within the interval', async () => {
    const { stream, controller } = controllableStream()
    const reader = withHeartbeat(stream, 1000).getReader()

    const chunk = encoder.encode('data: hello\n\n')
    controller.enqueue(chunk)
    const { value, done } = await reader.read()

    expect(done).toBe(false)
    expect(value).toEqual(chunk)
  })

  test('injects a heartbeat comment once the interval elapses with no chunk', async () => {
    const { stream, controller } = controllableStream()
    const reader = withHeartbeat(stream, 1000).getReader()

    const readPromise = reader.read()
    await vi.advanceTimersByTimeAsync(1000)
    const { value, done } = await readPromise

    expect(done).toBe(false)
    expect(value).toEqual(HEARTBEAT_CHUNK)

    // the upstream is still open and untouched -- a real chunk can still
    // arrive on the same pending read after the heartbeat fires.
    const chunk = encoder.encode('data: world\n\n')
    const nextRead = reader.read()
    controller.enqueue(chunk)
    expect((await nextRead).value).toEqual(chunk)
  })

  test('does not fire a heartbeat if the real chunk wins the race', async () => {
    const { stream, controller } = controllableStream()
    const reader = withHeartbeat(stream, 1000).getReader()

    const readPromise = reader.read()
    const chunk = encoder.encode('data: fast\n\n')
    controller.enqueue(chunk)
    await vi.advanceTimersByTimeAsync(1000)

    expect((await readPromise).value).toEqual(chunk)
  })

  test('closes cleanly when the upstream closes', async () => {
    const { stream, controller } = controllableStream()
    const reader = withHeartbeat(stream, 1000).getReader()

    controller.close()
    const { done } = await reader.read()
    expect(done).toBe(true)
  })

  test('propagates cancellation to the upstream reader', async () => {
    const { stream, wasCancelledWith } = controllableStream()
    const wrapped = withHeartbeat(stream, 1000)

    await wrapped.cancel('client disconnected')
    expect(wasCancelledWith()).toBe('client disconnected')
  })

  test('withholds a heartbeat mid-frame instead of splicing it into a partial SSE event', async () => {
    const { stream, controller } = controllableStream()
    const reader = withHeartbeat(stream, 1000).getReader()

    // ADK happens to deliver one SSE frame across two separate reads, with
    // the interval elapsing in between -- upstream is silent, but there is a
    // partially-delivered frame sitting in the pipe, not idle time between
    // frames.
    const partial = encoder.encode('data: {"content":"hel')
    controller.enqueue(partial)
    expect((await reader.read()).value).toEqual(partial)

    const readPromise = reader.read()
    await vi.advanceTimersByTimeAsync(1000) // interval elapses mid-frame
    const rest = encoder.encode('lo"}\n\n')
    controller.enqueue(rest) // completes the frame

    // No heartbeat must appear here: it would land between "...hel" and
    // "lo..." and corrupt the frame for the client's JSON.parse.
    expect((await readPromise).value).toEqual(rest)

    // Now at a real frame boundary -- silence here is safe to heartbeat.
    const readPromise2 = reader.read()
    await vi.advanceTimersByTimeAsync(1000)
    expect((await readPromise2).value).toEqual(HEARTBEAT_CHUNK)
  })
})
