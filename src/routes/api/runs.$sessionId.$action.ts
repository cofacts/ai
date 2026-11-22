import { createFileRoute } from '@tanstack/react-router'
import { getCookie } from '@tanstack/react-start/server'
import { HEARTBEAT_INTERVAL_MS, withHeartbeat } from './run-sse'
import { ADK_APP_NAME } from '@/lib/adkClient'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

const ADK_BASE_URL = process.env.ADK_URL || 'http://localhost:8000'

// Background runs (adk/cofacts_ai/run_bus.py). The run lives on in ADK after
// the browser goes away; these routes only start it, watch it and stop it:
//
//   GET  /api/runs/:sessionId/events?since=<event id>
//        -> SSE that stays open: stored events after `since`, then every
//           run as it happens (see RunBus.open_events in adk/)
//   POST /api/runs/:sessionId/start   {newMessage} -> 202 | 409 {invocationId}
//   POST /api/runs/:sessionId/cancel  -> 202 | 404
//
// Each forwards to ADK with the signed-in user's id filled in, so a session
// id alone can't reach anyone else's run. ADK answers 503 when it has no
// Redis; the client then falls back to /api/run-sse.
const ACTIONS = {
  events: { method: 'GET', path: '/events' },
  start: { method: 'POST', path: '/runs' },
  cancel: { method: 'POST', path: '/runs/cancel' },
} as const

type Action = keyof typeof ACTIONS

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function forward(
  request: Request,
  params: { sessionId: string; action: string },
  method: 'GET' | 'POST',
): Promise<Response> {
  const action = ACTIONS[params.action as Action] as
    | (typeof ACTIONS)[Action]
    | undefined
  if (!action || action.method !== method) {
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

  const token = getCookie(SESSION_COOKIE_NAME)
  const url =
    `${ADK_BASE_URL}/apps/${ADK_APP_NAME}` +
    `/users/${encodeURIComponent(userId)}` +
    `/sessions/${encodeURIComponent(params.sessionId)}${action.path}` +
    since(request)

  const upstream = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: params.action === 'start' ? await request.text() : undefined,
    // Only the feed is tied to the browser: closing the tab stops
    // watching. Nothing here can stop the run itself.
    signal: params.action === 'events' ? request.signal : undefined,
  })

  if (params.action === 'events' && upstream.ok && upstream.body) {
    return new Response(withHeartbeat(upstream.body, HEARTBEAT_INTERVAL_MS), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  }

  if (!upstream.ok && upstream.status >= 500 && upstream.status !== 503) {
    console.error('[ADK runs]', params.action, upstream.status)
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function since(request: Request) {
  const value = new URL(request.url).searchParams.get('since')
  return value ? `?since=${encodeURIComponent(value)}` : ''
}

export const Route = createFileRoute('/api/runs/$sessionId/$action')({
  server: {
    handlers: {
      GET: ({ request, params }) => forward(request, params, 'GET'),
      POST: ({ request, params }) => forward(request, params, 'POST'),
    },
  },
})
