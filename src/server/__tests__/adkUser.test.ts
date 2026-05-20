import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@tanstack/react-start/server', () => ({
  getCookie: vi.fn(),
}))

vi.mock('../jwt', () => ({
  verifySessionToken: vi.fn(),
}))

import { getCookie } from '@tanstack/react-start/server'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { verifySessionToken } from '../jwt'
import { resolveAdkUserIdOrThrow } from '../adkUser'

const mockedGetCookie = vi.mocked(getCookie)
const mockedVerify = vi.mocked(verifySessionToken)

afterEach(() => {
  vi.clearAllMocks()
})

describe('resolveAdkUserIdOrThrow', () => {
  test('returns the user id when session cookie verifies', async () => {
    mockedGetCookie.mockReturnValueOnce('valid-token')
    mockedVerify.mockResolvedValueOnce({
      userId: 'user-1',
      issuedAt: 1,
      expiresAt: 2,
    })

    const id = await resolveAdkUserIdOrThrow()

    expect(id).toBe('user-1')
    expect(mockedVerify).toHaveBeenCalledWith('valid-token')
  })

  test('throws AUTH_EXPIRED Error when cookie is missing', async () => {
    mockedGetCookie.mockReturnValueOnce(undefined)

    await expect(resolveAdkUserIdOrThrow()).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE,
    )
    expect(mockedVerify).not.toHaveBeenCalled()
  })

  test('throws AUTH_EXPIRED Error when verify fails', async () => {
    mockedGetCookie.mockReturnValueOnce('bad-token')
    mockedVerify.mockRejectedValueOnce(
      new Error('signature verification failed'),
    )

    await expect(resolveAdkUserIdOrThrow()).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE,
    )
  })
})
