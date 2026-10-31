import { useRouterState } from '@tanstack/react-router'

import type { SiteNavProps } from '@/components/SiteNav'
import { NAV_LINKS, SiteNav } from '@/components/SiteNav'
import { useAuth } from '@/lib/auth'

/** The site-wide nav rendered by __root: SiteNav wired to the session and the current URL. */
export function GlobalNav() {
  const { user, isLoading, login, logout } = useAuth()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // The item whose local href is a prefix of the current path is the current page. Cofacts AI
  // still lives at / and /session/* until it moves to /ai.
  const isAi = pathname === '/' || pathname.startsWith('/session/')
  const current = isAi
    ? 'ai'
    : ((Object.keys(NAV_LINKS) as Array<keyof typeof NAV_LINKS>).find((key) => {
        const { href } = NAV_LINKS[key]
        return href.startsWith('/') && href !== '/' && pathname.startsWith(href)
      }) as SiteNavProps['current'])
  return (
    <SiteNav
      current={current}
      user={isLoading && !user ? undefined : user}
      onLogin={() => login()}
      onLogout={() => void logout()}
    />
  )
}
