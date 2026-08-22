// Session-not-found signal. `getSession` throws an Error with this sentinel
// message when ADK responds 404 to a session fetch — most commonly a stale
// `/session/:sessionId` tab left open across an account switch (logout +
// re-login as a different user), where the session belongs to the previous
// ADK user. The route matches on this to show a dedicated "session
// unavailable" state instead of the generic ADK-communication-error banner.
//
// Sentinel `Error.message` thrown by server functions on a 404 and matched
// here on the client. TanStack Start's serverFn handler serializes `Error`
// (via seroval) and the client re-throws it, so plain string matching is the
// contract that survives the RPC boundary (same pattern as
// AUTH_EXPIRED_MESSAGE in authExpired.ts).
export const SESSION_NOT_FOUND_MESSAGE = 'SESSION_NOT_FOUND'

export function isSessionNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message === SESSION_NOT_FOUND_MESSAGE
}

/**
 * Classifies an ADK session-fetch result so the caller can decide whether to
 * throw the SESSION_NOT_FOUND sentinel, fall back to generic ADK error
 * handling, or proceed normally. Split out from `getSession`'s handler
 * (which needs a request context to resolve the user, so it can't be called
 * directly in tests) purely so this branch is unit-testable on its own.
 */
export function classifySessionFetchResult(
  error: unknown,
  status: number,
): 'ok' | 'not-found' | 'error' {
  if (!error) return 'ok'
  return status === 404 ? 'not-found' : 'error'
}
