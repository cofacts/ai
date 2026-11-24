import { createFileRoute } from '@tanstack/react-router'
import { json, runRoute } from '@/server/runs'

// POST /api/runs/:sessionId/cancel
//
// 202 once the session's run is told to stop (here, or through Redis when
// another process holds it), 404 when there is none.
export const Route = createFileRoute('/api/runs/$sessionId/cancel')({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const ctx = await runRoute()
        if ('response' in ctx) return ctx.response
        return (await ctx.bus.cancel(ctx.userId, params.sessionId))
          ? json({}, 202)
          : json({ message: 'No run in progress' }, 404)
      },
    },
  },
})
