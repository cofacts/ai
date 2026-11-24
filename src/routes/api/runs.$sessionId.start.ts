import { createFileRoute } from '@tanstack/react-router'
import { getCookie } from '@tanstack/react-start/server'
import { AdkRunError, RunBusUnavailable } from '@/server/runBus'
import { json, runRoute } from '@/server/runs'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

// POST /api/runs/:sessionId/start  {newMessage}
//
// 202 once ADK has accepted the run, 409 while the session already has one.
// The run's events, starting with the stored message, come on the events
// feed; the invocation id isn't known until then.
export const Route = createFileRoute('/api/runs/$sessionId/start')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await runRoute()
        if ('response' in ctx) return ctx.response
        const { newMessage } = (await request.json()) as {
          newMessage: unknown
        }
        try {
          const { started } = await ctx.bus.start({
            userId: ctx.userId,
            sessionId: params.sessionId,
            newMessage,
            token: getCookie(SESSION_COOKIE_NAME),
          })
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
      },
    },
  },
})
