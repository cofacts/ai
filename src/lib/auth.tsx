// Client-side auth context for the BFF flow.
//
// Tokens live ONLY in an HttpOnly `cofacts_session` cookie set by the server's
// `/api/auth/callback` route. This module never sees the token, never touches
// localStorage/sessionStorage, and never calls rumors-api directly. Auth-aware
// data fetching goes through `/api/graphql`; user hydration is seeded by the
// SSR root loader (`getCurrentUserServerFn`); the OAuth flow is initiated via
// `/api/auth/login` (server-side proxy that hides the upstream URL).

import { createContext, useContext, useState } from 'react'
import { getCurrentUserServerFn } from '@/server/me.functions'

export type AvatarType = 'OpenPeeps' | 'Gravatar' | 'Facebook' | 'Github'

export interface CofactsUser {
  id: string
  name: string
  avatarUrl: string | null
  avatarType: AvatarType | null
  avatarData: string | null
}

interface AuthState {
  user: CofactsUser | null
  isLoading: boolean
  login: (redirectTo?: string) => void
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

export function buildLoginPath(redirectTo: string = '/'): string {
  return `/api/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode
  initialUser?: CofactsUser | null
}) {
  const [user, setUser] = useState<CofactsUser | null>(initialUser ?? null)
  const [isLoading, setIsLoading] = useState(false)

  function login(redirectTo: string = '/') {
    window.location.href = buildLoginPath(redirectTo)
  }

  async function logout() {
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
  }

  async function refreshUser() {
    setIsLoading(true)
    try {
      const fresh = await getCurrentUserServerFn()
      setUser(fresh)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
