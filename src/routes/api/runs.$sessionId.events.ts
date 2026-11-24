import { createFileRoute } from '@tanstack/react-router'
import { HEARTBEAT_INTERVAL_MS, withHeartbeat } from './run-sse'
import { SessionNotFound } from '@/server/runBus'
import { json, runRoute } from '@/server/runs'

// GET /api/runs/:sessionId/events?since=<event id>
//
// An SSE that stays open: the stored events after `since`, then every run of
// the session as it happens, started from this window or any other. See
// src/server/runBus.ts for the frames.
export const Route = createFileRoute('/api/runs/$sessionId/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await runRoute()
        if ('response' in ctx) return ctx.response
        const since = new URL(request.url).searchParams.get('since')
        try {
          const body = await ctx.bus.openEvents(
            ctx.userId,
            params.sessionId,
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
      },
    },
  },
})
