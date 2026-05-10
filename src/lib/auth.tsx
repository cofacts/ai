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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { QueryClient } from '@tanstack/react-query'
import type { CofactsUser } from '@/server/me.functions'
import { logout as logoutServerFn } from '@/server/auth.functions'
import { getCurrentUserServerFn } from '@/server/me.functions'
import { LoginModal } from '@/components/LoginModal'
import { AUTH_EXPIRED_EVENT } from './authExpired'

export type { CofactsUser }

const ME_QUERY_KEY = ['me'] as const

// Drop user-scoped caches so the previous user's session list and chat
// messages cannot be read by an anonymous viewer in the same tab. Both
// queries use staleTime/gcTime: Infinity, so removeQueries (not invalidate)
// is required for immediate eviction.
export function clearUserScopedCache(queryClient: QueryClient) {
  queryClient.setQueryData(ME_QUERY_KEY, null)
  queryClient.removeQueries({ queryKey: ['sessions'] })
  queryClient.removeQueries({ queryKey: ['chat'] })
  queryClient.removeQueries({ queryKey: ['feedback'] })
}

interface AuthState {
  user: CofactsUser | null
  isLoading: boolean
  login: (redirectTo?: string) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({
  children,
  serverLoadedUser,
}: {
  children: React.ReactNode
  serverLoadedUser?: CofactsUser | null
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const callLogout = useServerFn(logoutServerFn)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)

  const { data: user, isFetching } = useQuery<CofactsUser | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => getCurrentUserServerFn(),
    initialData: serverLoadedUser ?? null,
    staleTime: Infinity,
  })

  // Open LoginModal whenever any client-side call detects 401. The redirect
  // target is the current pathname so the user lands back where they were
  // after re-authenticating.
  useEffect(() => {
    const onAuthExpired = () => {
      setPendingRedirect(router.state.location.pathname)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [router])

  const login = useCallback((redirectTo?: string) => {
    setPendingRedirect(redirectTo ?? '')
  }, [])

  const logout = useCallback(async () => {
    try {
      await callLogout()
    } catch {
      // best-effort: clear local state even if the network call fails
    }
    clearUserScopedCache(queryClient)
  }, [callLogout, queryClient])

  const value = useMemo<AuthState>(
    () => ({ user: user ?? null, isLoading: isFetching, login, logout }),
    [user, isFetching, login, logout],
  )

  const isLoginModalOpen = pendingRedirect !== null

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginModal
        open={isLoginModalOpen}
        onOpenChange={(open) => {
          if (!open) setPendingRedirect(null)
        }}
        redirectPath={pendingRedirect || undefined}
      />
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
