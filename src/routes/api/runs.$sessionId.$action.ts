import { createFileRoute } from '@tanstack/react-router'
import { getCookie } from '@tanstack/react-start/server'
import { HEARTBEAT_INTERVAL_MS, withHeartbeat } from './run-sse'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'
import {
  AdkRunError,
  RunBusUnavailable,
  SessionNotFound,
} from '@/server/runBus'
import { runBus } from '@/server/runs'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

// Background runs, run here in the BFF (src/server/runBus.ts):
//
//   GET  /api/runs/:sessionId/events?since=<event id>
//        -> SSE that stays open: stored events after `since`, then every
//           run as it happens, from this window or any other
//   POST /api/runs/:sessionId/start   {newMessage} -> 202 | 409
//   POST /api/runs/:sessionId/cancel  -> 202 | 404
//
// Without REDIS_URL these answer 503 {"detail": {"reason": "disabled"}} and
// the client falls back to /api/run-sse.

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handle(
  request: Request,
  params: { sessionId: string; action: string },
  method: 'GET' | 'POST',
): Promise<Response> {
  const route = `${method} ${params.action}`
  if (!['GET events', 'POST start', 'POST cancel'].includes(route)) {
    return json({ message: 'Not found' }, 404)
  }

  let userId: string
  try {
    userId = await resolveAdkUserIdOrThrow()
  } catch (err) {
    if (err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE) {
      return json({ message: 'Authentication required' }, 401)
    }
    throw err
  }

  const bus = runBus()
  if (!bus) return json({ detail: { reason: 'disabled' } }, 503)
  const { sessionId } = params

  if (route === 'GET events') {
    const since = new URL(request.url).searchParams.get('since')
    try {
      const body = await bus.openEvents(
        userId,
        sessionId,
        since,
        request.signal,
      )
      return new Response(withHeartbeat(body, HEARTBEAT_INTERVAL_MS), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      if (err instanceof SessionNotFound) {
        return json({ message: 'Session not found' }, 404)
      }
      throw err
    }
  }

  if (route === 'POST start') {
    const { newMessage } = (await request.json()) as { newMessage: unknown }
    try {
      const { started } = await bus.start({
        userId,
        sessionId,
        newMessage,
        token: getCookie(SESSION_COOKIE_NAME),
      })
      // The run's events, starting with the stored message, come on the
      // feed; the invocation id isn't known until then.
      return json({ invocationId: null }, started ? 202 : 409)
    } catch (err) {
      if (err instanceof RunBusUnavailable) {
        return json({ detail: { reason: 'shutting_down' } }, 503)
      }
      if (err instanceof AdkRunError) {
        return json({ message: err.message }, err.status)
      }
      throw err
    }
  }

  // POST cancel
  return (await bus.cancel(userId, sessionId))
    ? json({}, 202)
    : json({ message: 'No run in progress' }, 404)
}

export const Route = createFileRoute('/api/runs/$sessionId/$action')({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params, 'GET'),
      POST: ({ request, params }) => handle(request, params, 'POST'),
    },
  },
})
