// Auth-expired signal. Callers dispatch AUTH_EXPIRED_EVENT (or throw an
// Error with AUTH_EXPIRED_MESSAGE that the router-level error handler
// dispatches for them); AuthProvider listens, clears user-scoped caches,
// and opens LoginModal.

export const AUTH_EXPIRED_EVENT = 'cofacts:auth-expired'

// Sentinel `Error.message` thrown by server functions on auth failure and
// matched here on the client. TanStack Start's serverFn handler serializes
// `Error` (via seroval) and the client re-throws it, so plain string
// matching is the contract that survives the RPC boundary.
export const AUTH_EXPIRED_MESSAGE = 'AUTH_EXPIRED'

export function isAuthExpiredError(err: unknown): boolean {
  return err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE
}

export function handleAuthExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
  }
}
