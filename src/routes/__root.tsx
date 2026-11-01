import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useMatches,
  useRouterState,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import appCss from '../styles/global.css?url'
import type { SiteNavProps } from '@/components/SiteNav'
import { NAV_LINKS, SiteNav } from '@/components/SiteNav'
import { AuthProvider, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { getCurrentUserServerFn } from '@/server/me.functions'
import { materialSymbolsHref } from '@/components/icons/material-symbols'

export const Route = createRootRoute({
  loader: async () => ({ serverLoadedUser: await getCurrentUserServerFn() }),
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
})

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
    /** Set when the route draws its own footer (or none). */
    hideGlobalFooter?: boolean
    /**
     * Pin the page to the viewport height (`h-dvh`) so it scrolls inside its own panels (the AI
     * chat with its side panels). Without it the document scrolls and the nav sticks to the top.
     * Independent of the footer: a route that also wants no footer sets hideGlobalFooter.
     */
    fillViewport?: boolean
  }
}

/**
 * The site shell: every page shares the nav and the footer (Penpot Layout/Nav, Layout/Footer).
 * A route opts out with staticData; a flag set on a parent route also covers its children.
 */
function RootComponent() {
  const { hideGlobalNav, fillViewport } = useMatches({
    select: (matches) => ({
      hideGlobalNav: matches.some((m) => m.staticData.hideGlobalNav),
      fillViewport: matches.some((m) => m.staticData.fillViewport),
    }),
    structuralSharing: true,
  })
  // Pages normally scroll the document: back/forward scroll restoration, #anchors, printing and
  // the collapsing mobile URL bar all depend on it. fillViewport screens are exactly the viewport
  // height instead; min-h-0 on their content lets the inner panels shrink and scroll.
  // The footer (Penpot Layout/Footer) is not built yet; when it is, select hideGlobalFooter
  // here and render it after <Outlet /> unless that flag is set.
  return (
    <div className={cn('flex flex-col', fillViewport ? 'h-dvh' : 'min-h-dvh')}>
      {!hideGlobalNav && (
        <div className={cn('shrink-0', !fillViewport && 'sticky top-0 z-30')}>
          <RootNav />
        </div>
      )}
      <Outlet />
    </div>
  )
}

/**
 * SiteNav wired to the session and the current URL. SiteNav itself only takes props (shared
 * components don't read data), so this wiring lives here. Being its own component keeps the
 * auth and URL subscriptions out of RootComponent.
 */
function RootNav() {
  const { user, isLoading, login, logout } = useAuth()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <SiteNav
      current={currentNavKey(pathname)}
      user={isLoading && !user ? undefined : user}
      onLogin={() => login()}
      onLogout={() => void logout()}
    />
  )
}

/** The nav item whose local href is a prefix of the path. */
function currentNavKey(pathname: string): SiteNavProps['current'] {
  // Cofacts AI still lives at / and /session/* until Track 5 moves it to /ai.
  if (pathname === '/' || pathname.startsWith('/session/')) return 'ai'
  return (Object.keys(NAV_LINKS) as Array<keyof typeof NAV_LINKS>).find(
    (key) => {
      const { href } = NAV_LINKS[key]
      return href.startsWith('/') && href !== '/' && pathname.startsWith(href)
    },
  ) as SiteNavProps['current']
}
