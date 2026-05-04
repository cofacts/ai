// Client-side auth context for the BFF flow.
//
// Tokens live ONLY in an HttpOnly `cofacts_session` cookie set by the server's
// `/api/auth/callback` route. This module never sees the token, never touches
// localStorage/sessionStorage, and never calls rumors-api directly. Auth-aware
// data fetching goes through TanStack server functions (e.g.
// `getCurrentUserServerFn`) which read the cookie and call rumors-api
// server-side; user hydration is seeded by the SSR root loader; the OAuth
// flow is initiated via the `login` server function (which hides the upstream
// rumors-api origin).

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { getCurrentUserServerFn } from '@/server/me.functions'
import type { CofactsUser } from '@/server/me.functions'
import { LoginModal } from '@/components/LoginModal'

export type { CofactsUser }

interface AuthState {
  user: CofactsUser | null
  isLoading: boolean
  login: (redirectTo?: string) => void
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({
  children,
  serverLoadedUser,
}: {
  children: React.ReactNode
  serverLoadedUser?: CofactsUser | null
}) {
  const [user, setUser] = useState<CofactsUser | null>(
    serverLoadedUser ?? null,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isLoginModalOpen, setLoginModalOpen] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | undefined>(
    undefined,
  )

  const login = useCallback((redirectTo?: string) => {
    setPendingRedirect(redirectTo)
    setLoginModalOpen(true)
  }, [])

  const logout = useCallback(async () => {
    setIsLoading(true)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      // best-effort: clear local state even if the network call fails
    }
    setUser(null)
    setIsLoading(false)
  }, [])

  const refreshUser = useCallback(async () => {
    setIsLoading(true)
    try {
      const fresh = await getCurrentUserServerFn()
      setUser(fresh)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, isLoading, login, logout, refreshUser }),
    [user, isLoading, login, logout, refreshUser],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginModal
        open={isLoginModalOpen}
        onOpenChange={setLoginModalOpen}
        redirectPath={pendingRedirect}
      />
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
