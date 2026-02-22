/**
 * Sessions API Route.
 *
 * GET  /api/sessions  — list all sessions for the default app + user
 * POST /api/sessions  — create a new session by ID
 *
 * Both endpoints proxy to ADK, keeping ADK off the public network.
 */
import { createFileRoute } from '@tanstack/react-router'
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
} from '@/lib/apiTypes'

const ADK_INTERNAL_URL = process.env.ADK_URL || 'http://localhost:8000'
const APP_NAME = 'cofacts-ai'
const USER_ID = 'anonymous'

export const Route = createFileRoute('/api/sessions')({
  server: {
    handlers: {
      GET: async (): Promise<Response> => {
        const adkResponse = await fetch(
          `${ADK_INTERNAL_URL}/apps/${APP_NAME}/users/${USER_ID}/sessions`,
        )

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

        const data: ListSessionsResponse = await adkResponse.json()
        return Response.json(data)
      },

      POST: async ({ request }): Promise<Response> => {
        const { session_id } = (await request.json()) as CreateSessionRequest

        const adkResponse = await fetch(
          `${ADK_INTERNAL_URL}/apps/${APP_NAME}/users/${USER_ID}/sessions/${session_id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
        )

        if (!adkResponse.ok && adkResponse.status !== 409) {
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

        const body: CreateSessionResponse = { ok: true }
        return Response.json(body)
      },
    },
  },
})
