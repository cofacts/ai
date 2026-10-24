import { describe, expect, test } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { handleAuthExpiredForProvider } from '../auth'

// AuthProvider's useEffect wires window.addEventListener(AUTH_EXPIRED_EVENT,
// () => handleAuthExpiredForProvider(queryClient, pathname, setPendingRedirect))
// verbatim — this exercises that exact handler rather than a re-implementation,
// covering the "AUTH_EXPIRED_EVENT -> cache clear + modal open" wiring without
// needing a full component render (this repo's Vite/Vitest setup does not yet
// support rendering React components in tests — see PR description).
describe('handleAuthExpiredForProvider (the AuthProvider AUTH_EXPIRED_EVENT listener)', () => {
  test('clears user-scoped caches and sets pendingRedirect, which opens LoginModal', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['auth'], { authenticated: true, userId: 'u1' })
    queryClient.setQueryData(['me'], {
      id: 'u1',
      name: 'Alice',
      avatarUrl: null,
      avatarType: null,
      avatarData: null,
    })
    queryClient.setQueryData(['sessions'], [{ id: 's1' }])

    let pendingRedirect: string | null = null
    handleAuthExpiredForProvider(queryClient, '/chat/s1', (path) => {
      pendingRedirect = path
    })

    // Cache clear: same assertions as the clearUserScopedCache test, reached
    // through the actual event-handler entry point this time.
    expect(queryClient.getQueryData(['auth'])).toEqual({
      authenticated: false,
      userId: null,
    })
    expect(queryClient.getQueryData(['me'])).toBeNull()
    expect(queryClient.getQueryData(['sessions'])).toBeUndefined()

    // Modal open: AuthProvider computes isLoginModalOpen = pendingRedirect !== null.
    expect(pendingRedirect).toBe('/chat/s1')
  })
})
