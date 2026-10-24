import { describe, expect, test } from 'vitest'
import {
  SESSION_NOT_FOUND_MESSAGE,
  classifySessionFetchResult,
  isSessionNotFoundError,
} from '../sessionNotFound'

describe('isSessionNotFoundError', () => {
  test('returns true for an Error with the SESSION_NOT_FOUND message', () => {
    expect(isSessionNotFoundError(new Error(SESSION_NOT_FOUND_MESSAGE))).toBe(
      true,
    )
  })

  test('returns false for other errors and non-error values', () => {
    expect(isSessionNotFoundError(new Error('something else'))).toBe(false)
    expect(isSessionNotFoundError(null)).toBe(false)
    expect(isSessionNotFoundError(undefined)).toBe(false)
    expect(isSessionNotFoundError({ message: SESSION_NOT_FOUND_MESSAGE })).toBe(
      false,
    )
  })
})

describe('classifySessionFetchResult', () => {
  test('is "ok" when ADK returned no error, regardless of status', () => {
    expect(classifySessionFetchResult(undefined, 200)).toBe('ok')
  })

  test('is "not-found" on a 404, the stale-session-URL case', () => {
    expect(classifySessionFetchResult({ detail: 'not found' }, 404)).toBe(
      'not-found',
    )
  })

  test('is "error" for any other status when ADK returned an error', () => {
    expect(classifySessionFetchResult({ detail: 'boom' }, 500)).toBe('error')
    expect(classifySessionFetchResult({ detail: 'bad request' }, 400)).toBe(
      'error',
    )
  })
})
