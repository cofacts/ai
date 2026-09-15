import { createFileRoute } from '@tanstack/react-router'
import { getCookie } from '@tanstack/react-start/server'
import type { components } from '@/lib/adk-types'
import { ADK_APP_NAME, adkClient } from '@/lib/adkClient'
import { handleAdkResponseError } from '@/lib/adk-errors'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

type RunRequest = components['schemas']['RunAgentRequest']
type ChatInput = Omit<RunRequest, 'appName' | 'userId' | 'streaming'>

// Cloudflare's edge (cofacts.ai and cofacts.tw are both on non-Enterprise
// plans) force-closes a proxied connection after 125s without a byte from the
// origin — the "Proxy Read Timeout"; see
// https://developers.cloudflare.com/fundamentals/reference/connection-limits/.
// Enterprise can raise it, we can't. A whole turn can go well past that (a
// completed call_llm span has run up to 195s), but any single span emits
// tokens the whole time — except calls wrapped as AgentTool (investigator,
// verifier): ADK runs those through their own internal Runner and only
// yields their final merged text back to the caller once the whole sub-turn
// finishes (google.adk.tools.agent_tool.AgentTool.run_async), so a long
// google_search/url_context sub-turn is 100% silent on this stream for its
// entire duration, however long that is. When that silence clears 125s,
// Cloudflare kills the browser-facing connection; ingress's fetch to ADK
// aborts via the shared `signal` below, ADK cancels the in-flight call to
// Vertex, and the whole turn is lost with no error anywhere (Starlette/
// uvicorn don't log a client-disconnect cancellation as an error, so nothing
// shows up in the backend's own logs either).
//
// Sending a comment line at a fixed cadence keeps bytes flowing on this leg
// regardless of what the backend is doing upstream. chatCache.ts's parser
// only reads `data: ` lines out of each `\n\n`-delimited part and ignores
// everything else, so a heartbeat sitting *between* two complete SSE frames
// is invisible to it — but a heartbeat spliced into the middle of one (a
// frame ADK happened to deliver across two separate reads) would corrupt
// that frame's `data: ` line and get silently swallowed by the client's
// `catch {}` around JSON.parse: the exact silent data loss this fix exists
// to prevent. So a heartbeat is only ever injected right after a `\n\n`
// we've already forwarded; if the timer fires mid-frame we withhold it and
// keep waiting on the same read instead.
export const HEARTBEAT_INTERVAL_MS = 20_000
export const HEARTBEAT_CHUNK = new TextEncoder().encode(': heartbeat\n\n')

const NEWLINE = 0x0a

// Wrap an upstream byte stream so that, whenever more than intervalMs passes
// without a chunk from `upstream`, we inject an SSE comment line instead of
// letting the outgoing connection go idle. Real chunks are passed through
// unchanged and immediately reset the timer.
export function withHeartbeat(
  upstream: ReadableStream<Uint8Array>,
  intervalMs: number,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader()

  // Consecutive '\n' bytes at the end of everything forwarded so far, capped
  // at 2. >= 2 means the last thing we sent ended in a blank line, i.e. a
  // safe SSE frame boundary. Starts at 2: nothing has been sent yet, so a
  // heartbeat right now would just be the first thing on the wire.
  //
  // This means a mid-frame stall longer than intervalMs still can't be
  // covered (there's nowhere safe to put a heartbeat until the frame
  // completes) — correctness over liveness. That's fine in practice: ADK
  // writes each frame as one `data: {...}\n\n` in a single yield, so two
  // reads of one frame are a TCP fragmentation artifact, not a slow-backend
  // artifact, and stalling >125s between them isn't the failure mode this
  // fix targets (a slow *sub-agent turn* stalls between frames, which this
  // does cover).
  let trailingNewlines = 2
  function noteForwarded(chunk: Uint8Array) {
    for (const byte of chunk) {
      trailingNewlines =
        byte === NEWLINE ? Math.min(trailingNewlines + 1, 2) : 0
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let pendingRead = reader.read()

      for (;;) {
        let timer: ReturnType<typeof setTimeout>
        const timedOut = Symbol('timed-out')
        const timeout = new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), intervalMs)
        })

        let outcome: Awaited<typeof pendingRead> | typeof timedOut
        try {
          outcome = await Promise.race([pendingRead, timeout])
        } catch (err) {
          clearTimeout(timer!)
          // pendingRead only ever rejects once `upstream` itself has already
          // transitioned to "errored" (we never call reader.releaseLock()),
          // so there's no live connection left to release here -- per the
          // Streams spec, cancelling an already-errored reader is a no-op
          // that skips the underlying source's own cancel() entirely
          // (verified: Node never invokes it in this case). Just propagate.
          controller.error(err)
          return
        }
        clearTimeout(timer!)

        if (outcome === timedOut) {
          if (trailingNewlines >= 2) {
            controller.enqueue(HEARTBEAT_CHUNK.slice())
          }
          continue // keep waiting on the same pendingRead either way
        }

        const { done, value } = outcome
        if (done) {
          controller.close()
          return
        }
        noteForwarded(value)
        controller.enqueue(value)
        pendingRead = reader.read()
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}

// Thin proxy for ADK's /run_sse endpoint.
//
// We cannot use a createServerFn() streaming server function here because
// TanStack Start's serverFnFetcher (the RPC client implementation) swallows
// AbortError in its internal IIFE, so AbortController.abort() on the client
// never unblocks the for-await loop.
// A plain API route lets the client use fetch() directly, where reader.read()
// throws AbortError immediately with no intermediate layer in between.
export const Route = createFileRoute('/api/run-sse')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string
        try {
          userId = await resolveAdkUserIdOrThrow()
        } catch (err) {
          if (err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE) {
            return new Response(
              JSON.stringify({ message: 'Authentication required' }),
              {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
          throw err
        }

        const input = (await request.json()) as ChatInput
        const token = getCookie(SESSION_COOKIE_NAME)

        const { response } = await adkClient.POST('/run_sse', {
          parseAs: 'stream',
          body: {
            ...input,
            appName: ADK_APP_NAME,
            userId,
            streaming: true,
          },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          // When the client aborts the fetch, request.signal fires (via srvx),
          // which in turn aborts the ADK SSE connection.
          signal: request.signal,
        })

        if (!response.ok) {
          handleAdkResponseError(response)
        }

        return new Response(
          withHeartbeat(response.body!, HEARTBEAT_INTERVAL_MS),
          {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            },
          },
        )
      },
    },
  },
})
