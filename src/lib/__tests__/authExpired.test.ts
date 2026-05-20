// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import {
  AUTH_EXPIRED_EVENT,
  AUTH_EXPIRED_MESSAGE,
  handleAuthExpired,
  isAuthExpiredError,
} from '../authExpired'

describe('isAuthExpiredError', () => {
  test('returns true for an Error with the AUTH_EXPIRED message', () => {
    expect(isAuthExpiredError(new Error(AUTH_EXPIRED_MESSAGE))).toBe(true)
  })

  test('returns false for other errors and non-error values', () => {
    expect(isAuthExpiredError(new Error('something else'))).toBe(false)
    expect(isAuthExpiredError(new Response(null, { status: 401 }))).toBe(false)
    expect(isAuthExpiredError(null)).toBe(false)
    expect(isAuthExpiredError(undefined)).toBe(false)
    expect(isAuthExpiredError({ message: AUTH_EXPIRED_MESSAGE })).toBe(false)
    expect(isAuthExpiredError(AUTH_EXPIRED_MESSAGE)).toBe(false)
  })
})

describe('handleAuthExpired', () => {
  test('dispatches AUTH_EXPIRED_EVENT on window', () => {
    const handler = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, handler)

    handleAuthExpired()

    expect(handler).toHaveBeenCalledTimes(1)

    window.removeEventListener(AUTH_EXPIRED_EVENT, handler)
  })
})
