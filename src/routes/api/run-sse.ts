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
            stateDelta: token ? { 'temp:cofacts_token': token } : undefined,
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
