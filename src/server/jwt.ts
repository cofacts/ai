// Verifies the BFF session cookie JWT against rumors-api's JWKS so we can read
// the user id locally without a per-request `GetUser` round-trip. Pin algorithm
// to RS256 to defend against alg-confusion (e.g. forged HS256 token using the
// public key as a shared secret). Throws on invalid signature, expired token,
// missing claims, or wrong alg — callers decide how to map to HTTP status.

import { jwtVerify } from 'jose'
import { getJWKS } from './jwks'

export interface VerifiedSession {
  userId: string
  issuedAt: number
  expiresAt: number
}

export async function verifySessionToken(
  token: string,
): Promise<VerifiedSession> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    algorithms: ['RS256'],
  })
  if (typeof payload.sub !== 'string') {
    throw new Error('JWT missing sub claim')
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new Error('JWT missing iat/exp claims')
  }
  return {
    userId: payload.sub,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  }
}
