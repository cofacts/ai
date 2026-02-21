/**
 * SSE Proxy Server Route for ADK.
 *
 * This route proxies POST requests from the browser to ADK's /run_sse endpoint,
 * avoiding CORS issues since both the frontend and this proxy run on localhost:3000.
 *
 * The browser sends a POST to /api/chat, this handler forwards it to ADK at :8000,
 * and streams the SSE response back without buffering.
 */
import { createFileRoute } from '@tanstack/react-router'

const ADK_INTERNAL_URL = process.env.ADK_URL || 'http://localhost:8000'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()

        // ADK requires the session to exist before calling /run_sse.
        // Create it upfront; ignore 409 if it already exists.
        await fetch(
          `${ADK_INTERNAL_URL}/apps/${body.app_name}/users/${body.user_id}/sessions/${body.session_id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        )

        const adkResponse = await fetch(`${ADK_INTERNAL_URL}/run_sse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: request.signal,
        })

        if (!adkResponse.ok) {
          return new Response(
            JSON.stringify({
              error: `ADK returned ${adkResponse.status}: ${adkResponse.statusText}`,
            }),
            {
              status: adkResponse.status,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }

        // Stream the SSE response back to the client without buffering
        return new Response(adkResponse.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      },
    },
  },
})
