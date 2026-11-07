import { isAuthExpiredError } from '@/lib/authExpired'

/**
 * The inline message for the first failed query or mutation, or null.
 * AUTH_EXPIRED is skipped: the global QueryCache / MutationCache handler opens
 * the login modal for it.
 */
export function failureMessage(errors: Array<unknown>): string | null {
  const err = errors.find((e) => e && !isAuthExpiredError(e))
  if (!err) return null
  return err instanceof Error ? err.message : '送出失敗，請再試一次'
}
