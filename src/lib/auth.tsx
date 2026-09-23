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
import { AUTH_EXPIRED_EVENT } from './authExpired'
import { chatCacheKey } from './chatCache'
import type { QueryClient } from '@tanstack/react-query'
import type { AuthStatus } from '@/server/auth.status.functions'
import type { CofactsUser } from '@/server/me.functions'
import { logout as logoutServerFn } from '@/server/auth.functions'
import {
  UNAUTHENTICATED,
  getAuthStatusServerFn,
} from '@/server/auth.status.functions'
import { getCurrentUserServerFn } from '@/server/me.functions'
import { LoginModal } from '@/components/LoginModal'

export type { CofactsUser }

// Authoritative gate: JWT-only, never calls rumors-api. staleTime: Infinity
// because a session's validity doesn't change client-side; AUTH_EXPIRED_EVENT
// (dispatched on a 401 from any server fn) is what invalidates it.
const AUTH_QUERY_KEY = ['auth'] as const
// Cosmetic profile: independent of the auth gate, safe to be null, and
// allowed to retry/refetch on its own schedule without affecting whether the
// user is considered logged in.
const ME_QUERY_KEY = ['me'] as const
const ME_STALE_TIME_MS = 60_000

// Drop user-scoped caches so the previous user's session list and chat
// messages cannot be read by an anonymous viewer in the same tab. All
// queries use staleTime/gcTime: Infinity (or are keyed out here explicitly),
// so removeQueries/setQueryData (not invalidate) is required for immediate
// eviction.
export function clearUserScopedCache(queryClient: QueryClient) {
  queryClient.setQueryData(AUTH_QUERY_KEY, UNAUTHENTICATED)
  queryClient.setQueryData(ME_QUERY_KEY, null)
  queryClient.removeQueries({ queryKey: ['sessions'] })
  queryClient.removeQueries({ queryKey: chatCacheKey() })
  queryClient.removeQueries({ queryKey: ['feedback'] })
}

// The AUTH_EXPIRED_EVENT reaction, factored out of the useEffect below so it
// can be unit-tested without rendering <AuthProvider>: clear user-scoped
// caches, then hand the current pathname to the pendingRedirect setter —
// AuthProvider derives `isLoginModalOpen` from `pendingRedirect !== null`, so
// this call is what opens LoginModal.
export function handleAuthExpiredForProvider(
  queryClient: QueryClient,
  pathname: string,
  setPendingRedirect: (path: string) => void,
) {
  clearUserScopedCache(queryClient)
  setPendingRedirect(pathname)
}

interface AuthState {
  authenticated: boolean
  userId: string | null
  user: CofactsUser | null
  isLoading: boolean
  login: (redirectTo?: string) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({
  children,
  serverLoadedAuth,
  serverLoadedUser,
}: {
  children: React.ReactNode
  serverLoadedAuth?: AuthStatus
  serverLoadedUser?: CofactsUser | null
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const callLogout = useServerFn(logoutServerFn)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)

  const { data: authStatus, isFetching: isAuthFetching } = useQuery<AuthStatus>(
    {
      queryKey: AUTH_QUERY_KEY,
      queryFn: () => getAuthStatusServerFn(),
      initialData: serverLoadedAuth ?? UNAUTHENTICATED,
      staleTime: Infinity,
    },
  )

  const authenticated = authStatus.authenticated

  const { data: user } = useQuery<CofactsUser | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => getCurrentUserServerFn(),
    initialData: serverLoadedUser ?? null,
    enabled: authenticated,
    staleTime: ME_STALE_TIME_MS,
    retry: 2,
  })

  // Owns the AUTH_EXPIRED_EVENT reaction: clear user-scoped caches and
  // open LoginModal anchored to the current pathname so re-auth lands the
  // user back where they were.
  useEffect(() => {
    const onAuthExpired = () =>
      handleAuthExpiredForProvider(
        queryClient,
        router.state.location.pathname,
        setPendingRedirect,
      )
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [router, queryClient])

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
    () => ({
      authenticated,
      userId: authStatus.userId,
      user: user ?? null,
      isLoading: isAuthFetching,
      login,
      logout,
    }),
    [authenticated, authStatus.userId, user, isAuthFetching, login, logout],
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
