import { createFileRoute } from '@tanstack/react-router'
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
// Cannot import ChatRequest from apiTypes since we are deleting it. We can import it from adk-types instead.
import type { components } from '@/lib/adk-types'
import { adkClient } from '@/lib/adkClient'

type RunRequest = components['schemas']['RunAgentRequest']

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }): Promise<Response> => {
        const body = (await request.json()) as RunRequest

        const { response: adkResponse } = await adkClient.POST(
          '/run_sse',
          {
            parseAs: 'stream',
            body,
            signal: request.signal,
          },
        )

        // adkClient typings return `error` if HTTP status is not successful.
        // But since `parseAs: 'stream'` returns Response directly, `error` might not be parsed,
        // or response.ok handles it.
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
