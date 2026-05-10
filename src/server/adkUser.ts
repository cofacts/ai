// Resolves the current user's Cofacts ID for the ADK `user_id` parameter by
// verifying the BFF session cookie JWT locally — avoids a per-request rumors-api
// `GetUser` round-trip (which is rate-limited). Falls through to 401 on missing
// cookie or any verify failure (bad signature, expired, wrong alg, missing claims).
//
// Auth failure throws `new Error(AUTH_EXPIRED_MESSAGE)` so the serverFn
// client re-throws it on the caller side, letting React Query's onError fire
// and the global auth-expired handler prompt re-login.

import { getCookie } from '@tanstack/react-start/server'

import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { SESSION_COOKIE_NAME } from './sessionCookie'
import { verifySessionToken } from './jwt'

export async function resolveAdkUserIdOrThrow(): Promise<string> {
  const token = getCookie(SESSION_COOKIE_NAME)
  if (!token) throw new Error(AUTH_EXPIRED_MESSAGE)
  try {
    const { userId } = await verifySessionToken(token)
    return userId
  } catch {
    throw new Error(AUTH_EXPIRED_MESSAGE)
  }
}
