import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useMatches,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import appCss from '../styles/global.css?url'
import type { QueryClient } from '@tanstack/react-query'
import { GlobalNav } from '@/components/GlobalNav'
import { AuthProvider } from '@/lib/auth'
import { getCurrentUserServerFn } from '@/server/me.functions'
import { materialSymbolsHref } from '@/components/ui/material-symbols'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: async () => ({ serverLoadedUser: await getCurrentUserServerFn() }),
    // SSR renders the logged-in view (the user, and later per-user data, is in the HTML), so a
    // shared cache must never store it.
    headers: ({ loaderData }) =>
      loaderData?.serverLoadedUser
        ? { 'Cache-Control': 'private, no-store' }
        : undefined,
    head: () => ({
      meta: [
        {
          charSet: 'utf-8',
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          title: 'Cofacts.ai — AI 協助公民查核',
        },
        {
          name: 'description',
          content:
            'Cofacts.ai 是一個對話式 AI 查核協作平台，讓查核協作者可以透過 AI 輔助來查核可疑訊息、撰寫回應。',
        },
      ],
      links: [
        {
          rel: 'stylesheet',
          href: appCss,
        },
        {
          rel: 'preconnect',
          href: 'https://fonts.googleapis.com',
        },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossOrigin: 'anonymous',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap',
        },
        {
          rel: 'stylesheet',
          href: materialSymbolsHref,
        },
      ],
    }),

    component: RootComponent,
    shellComponent: RootDocument,
  },
)

function RootDocument({ children }: { children: React.ReactNode }) {
  const { serverLoadedUser } = Route.useLoaderData()
  return (
    <html lang="zh-TW">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider serverLoadedUser={serverLoadedUser}>
          {children}
        </AuthProvider>
        <ReactQueryDevtools />
        <Scripts />
      </body>
    </html>
  )
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** Set when the route draws its own nav (or none). */
    hideGlobalNav?: boolean
    /** Set on screens with a side panel, or that draw their own footer. */
    hideGlobalFooter?: boolean
  }
}

/**
 * The site shell: every page shares GlobalNav and the footer (Penpot Layout/Nav, Layout/Footer).
 * A route opts out with staticData; a flag set on a parent route also covers its children.
 */
function RootComponent() {
  const { hideGlobalNav, hideGlobalFooter } = useMatches({
    select: (matches) => ({
      hideGlobalNav: matches.some((m) => m.staticData.hideGlobalNav),
      hideGlobalFooter: matches.some((m) => m.staticData.hideGlobalFooter),
    }),
    structuralSharing: true,
  })
  // Pages scroll with a footer at the end. Screens without a footer (side panels) are pinned to
  // the viewport height instead, and scroll inside their panels.
  // The footer (Penpot Layout/Footer) is not built yet; it goes after <Outlet /> behind
  // hideGlobalFooter.
  return (
    <div
      className={
        hideGlobalFooter
          ? 'flex h-dvh flex-col overflow-hidden'
          : 'flex min-h-dvh flex-col'
      }
    >
      {!hideGlobalNav && <GlobalNav />}
      <Outlet />
    </div>
  )
}
