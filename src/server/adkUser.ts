// Resolves the current user's Cofacts ID for the ADK `user_id` parameter by
// verifying the BFF session cookie JWT locally — avoids a per-request rumors-api
// `GetUser` round-trip (which is rate-limited). Falls through to 401 on missing
// cookie or any verify failure (bad signature, expired, wrong alg, missing claims).
//
// Auth failure throws `Response`: TanStack Start's serverFn handler passes
// thrown Response objects through verbatim, and the client deserializer hands
// the same Response to the caller, so HTTP status survives the RPC boundary.

import { getCookie } from '@tanstack/react-start/server'

import { SESSION_COOKIE_NAME } from './sessionCookie'
import { verifySessionToken } from './jwt'

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ message: 'Authentication required' }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export async function resolveAdkUserIdOrThrow(): Promise<string> {
  const token = getCookie(SESSION_COOKIE_NAME)
  if (!token) throw unauthorized()
  try {
    const { userId } = await verifySessionToken(token)
    return userId
  } catch {
    throw unauthorized()
  }
}
