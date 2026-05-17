import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { routeTree } from './routeTree.gen'
import { handleAuthExpired, isAuthExpiredError } from './lib/authExpired'

export const getRouter = () => {
  // Fresh router + QueryClient per request: a module-scoped QueryClient would
  // let one user's SSR-populated cache (e.g. ['me']) leak into the next
  // request's render under Nitro's long-lived process.
  const onError = (err: unknown) => {
    if (isAuthExpiredError(err)) {
      handleAuthExpired()
    }
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: Infinity,
      },
    },
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  })

  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}
