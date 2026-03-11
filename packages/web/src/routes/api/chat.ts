/**
 * SSE Proxy Server Route for ADK.
 *
 * This route proxies POST requests from the browser to ADK's /run_sse endpoint,
 * avoiding CORS issues since both the frontend and this proxy run on localhost:3000.
 *
 * The browser sends a POST to /api/chat, this handler forwards it to ADK at :8000,
 * and streams the SSE response back without buffering.
 *
 * Sessions must be created beforehand via POST /api/sessions.
 */
import { createFileRoute } from '@tanstack/react-router'
import type { ChatRequest } from '@/lib/apiTypes'

const ADK_INTERNAL_URL = process.env.ADK_URL || 'http://localhost:8000'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }): Promise<Response> => {
        const body = (await request.json()) as ChatRequest

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
