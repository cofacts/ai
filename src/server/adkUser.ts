// Server-side helper that resolves the current user's Cofacts ID for use as
// the ADK `user_id` path/body parameter. Reads the HttpOnly cofacts_session
// cookie (via cofactsExec) and dispatches GetCurrentUser. Throws a 401-shaped
// Response when no authenticated user is present so callers can let the
// framework propagate it back to the browser.

import { getCurrentUserServerFn } from './me.functions'

export class UnauthorizedError extends Error {
  readonly status = 401
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export async function resolveAdkUserIdOrThrow(): Promise<string> {
  const user = await getCurrentUserServerFn()
  if (!user) {
    throw new UnauthorizedError()
  }
  return user.id
}
