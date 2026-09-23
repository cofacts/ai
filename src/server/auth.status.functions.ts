// TanStack Start server function exposing pure authentication status.
//
// JWT-only: verifies the cofacts_session cookie locally against rumors-api's
// JWKS and never calls rumors-api's GetUser. This is deliberately separate
// from getCurrentUserServerFn (me.functions.ts) so "is this session
// authenticated?" cannot be conflated with "did the profile fetch succeed?" —
// the latter can fail or rate-limit independently of a valid session.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

import { verifySessionToken } from './jwt'
import { SESSION_COOKIE_NAME } from './sessionCookie'

export interface AuthStatus {
  authenticated: boolean
  userId: string | null
}

export const UNAUTHENTICATED: AuthStatus = {
  authenticated: false,
  userId: null,
}

export const getAuthStatusServerFn = createServerFn({
  method: 'GET',
}).handler(async (): Promise<AuthStatus> => {
  const token = getCookie(SESSION_COOKIE_NAME)
  if (!token) return UNAUTHENTICATED

  try {
    const { userId } = await verifySessionToken(token)
    return { authenticated: true, userId }
  } catch {
    return UNAUTHENTICATED
  }
})
