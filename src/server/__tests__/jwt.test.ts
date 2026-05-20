import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
}))

vi.mock('../jwks', () => ({
  getJWKS: vi.fn(() => 'mock-jwks-resolver'),
}))

describe('verifySessionToken', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('returns userId/issuedAt/expiresAt on valid token and pins RS256', async () => {
    const { jwtVerify } = await import('jose')
    const { getJWKS } = await import('../jwks')
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: 'u1', iat: 1700000000, exp: 1701000000 },
      protectedHeader: { alg: 'RS256' },
    } as never)

    const { verifySessionToken } = await import('../jwt')
    const result = await verifySessionToken('tok')

    expect(result).toEqual({
      userId: 'u1',
      issuedAt: 1700000000,
      expiresAt: 1701000000,
    })
    expect(jwtVerify).toHaveBeenCalledWith(
      'tok',
      vi.mocked(getJWKS).mock.results[0].value,
      { algorithms: ['RS256'] },
    )
  })

  test('throws when sub claim is missing', async () => {
    const { jwtVerify } = await import('jose')
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { iat: 1, exp: 2 },
      protectedHeader: { alg: 'RS256' },
    } as never)

    const { verifySessionToken } = await import('../jwt')
    await expect(verifySessionToken('tok')).rejects.toThrow(
      'JWT missing sub claim',
    )
  })

  test('throws when iat or exp is missing', async () => {
    const { jwtVerify } = await import('jose')
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { sub: 'u1' },
      protectedHeader: { alg: 'RS256' },
    } as never)

    const { verifySessionToken } = await import('../jwt')
    await expect(verifySessionToken('tok')).rejects.toThrow(
      'JWT missing iat/exp claims',
    )
  })

  test('propagates errors from jwtVerify (invalid sig / expired)', async () => {
    const { jwtVerify } = await import('jose')
    vi.mocked(jwtVerify).mockRejectedValueOnce(
      new Error('signature verification failed'),
    )

    const { verifySessionToken } = await import('../jwt')
    await expect(verifySessionToken('tok')).rejects.toThrow(
      'signature verification failed',
    )
  })
})
