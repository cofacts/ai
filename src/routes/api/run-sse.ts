import { createFileRoute } from '@tanstack/react-router'
import { ADK_APP_NAME, ADK_USER_ID, adkClient } from '@/lib/adkClient'
import { handleAdkResponseError } from '@/lib/adk.server'
import type { components } from '@/lib/adk-types'

type RunRequest = components['schemas']['RunAgentRequest']
type ChatInput = Omit<RunRequest, 'appName' | 'userId' | 'streaming'>

export const Route = createFileRoute('/api/run-sse')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const input = (await request.json()) as ChatInput

        const { response } = await adkClient.POST('/run_sse', {
          parseAs: 'stream',
          body: {
            ...input,
            appName: ADK_APP_NAME,
            userId: ADK_USER_ID,
            streaming: true,
          },
          // When the client aborts the fetch, request.signal fires (via srvx),
          // which in turn aborts the ADK SSE connection.
          signal: request.signal,
        })

        if (!response.ok) {
          handleAdkResponseError(response)
        }

        return new Response(response.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        })
      },
    },
  },
})
