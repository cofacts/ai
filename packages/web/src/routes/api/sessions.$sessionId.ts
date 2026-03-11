import { createFileRoute } from '@tanstack/react-router'
import type { AdkSession } from '@/lib/adk'

const ADK_INTERNAL_URL = process.env.ADK_URL || 'http://localhost:8000'
const APP_NAME = 'cofacts-ai'
const USER_ID = 'anonymous'

export const Route = createFileRoute('/api/sessions/$sessionId')({
  server: {
    handlers: {
      GET: async ({ params }): Promise<Response> => {
        const { sessionId } = params
        const adkResponse = await fetch(
          `${ADK_INTERNAL_URL}/apps/${APP_NAME}/users/${USER_ID}/sessions/${sessionId}`,
        )

        if (!adkResponse.ok) {
          if (adkResponse.status === 404) {
            return new Response(
              JSON.stringify({ error: 'Session not found' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }
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

        const data: AdkSession = await adkResponse.json()
        return Response.json(data)
      },
    },
  },
})
