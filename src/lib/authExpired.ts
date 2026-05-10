// Centralized 'session expired' handler. When any client-side call to a
// server function or fetch returns 401 (cookie/JWT expired or missing), we
// must (a) drop user-scoped caches so stale data from the previous session
// isn't shown, (b) reset useAuth().user to null so the layout switches to
// the logged-out landing, and (c) prompt the user to re-authenticate. We
// use a custom DOM event to keep this module React-free; AuthProvider
// listens for it and opens LoginModal.

import type { QueryClient } from '@tanstack/react-query'
import { clearUserScopedCache } from './auth'

export const AUTH_EXPIRED_EVENT = 'cofacts:auth-expired'

// Sentinel `Error.message` thrown by server functions on auth failure and
// matched here on the client. TanStack Start's serverFn handler serializes
// `Error` (via seroval) and the client re-throws it, so plain string
// matching is the contract that survives the RPC boundary.
export const AUTH_EXPIRED_MESSAGE = 'AUTH_EXPIRED'

export function isAuthExpiredError(err: unknown): boolean {
  return err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE
}

export function handleAuthExpired(queryClient: QueryClient): void {
  clearUserScopedCache(queryClient)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
  }
}
