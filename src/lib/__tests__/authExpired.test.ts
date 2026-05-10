// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
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
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
    queryClient.setQueryData(['me'], { id: 'u1', name: 'x' })
    queryClient.setQueryData(['sessions'], [{ id: 's1' }])
  })

  afterEach(() => {
    queryClient.clear()
  })

  test('clears user-scoped cache and dispatches event', () => {
    const handler = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, handler)

    handleAuthExpired(queryClient)

    expect(queryClient.getQueryData(['me'])).toBeNull()
    expect(queryClient.getQueryData(['sessions'])).toBeUndefined()
    expect(handler).toHaveBeenCalledTimes(1)

    window.removeEventListener(AUTH_EXPIRED_EVENT, handler)
  })
})
