// Server-only lazy singleton JWKS resolver.
// Fetches the public key set from rumors-api's /.well-known/jwks.json endpoint
// and caches it via jose's built-in remote JWKSet cache (handles refresh,
// cooldown, and timeouts internally). Consumed by jose.jwtVerify in jwt.ts.

import { createRemoteJWKSet } from 'jose'
import { getApiBase } from './api-base'

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null

export function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedJWKS) {
    cachedJWKS = createRemoteJWKSet(
      new URL('/.well-known/jwks.json', getApiBase()),
      {
        cacheMaxAge: 10 * 60 * 1000,
        cooldownDuration: 30 * 1000,
        timeoutDuration: 5 * 1000,
      },
    )
  }
  return cachedJWKS
}
