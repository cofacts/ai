/**
 * Typed client-side helpers for the app's API routes.
 * Use these instead of raw fetch() to get end-to-end type safety.
 */
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ListSessionsResponse,
} from './apiTypes'

export async function createSession(
  sessionId: string,
): Promise<CreateSessionResponse> {
  const body: CreateSessionRequest = { session_id: sessionId }
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`)
  return res.json() as Promise<CreateSessionResponse>
}

export async function listSessions(): Promise<ListSessionsResponse> {
  const res = await fetch('/api/sessions')
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`)
  return res.json() as Promise<ListSessionsResponse>
}
