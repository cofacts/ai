import { Outlet, createFileRoute, useMatches } from '@tanstack/react-router'

import type { SiteNavProps } from '@/components/SiteNav'
import { SiteNav } from '@/components/SiteNav'
import { useAuth } from '@/lib/auth'

/** Layout for the public site pages (articles, replies, …): SiteNav on top. */
export const Route = createFileRoute('/_site')({
  component: SiteLayout,
})

/** Which nav item each route lights up. */
const CURRENT_BY_ROUTE: Record<string, SiteNavProps['current']> = {
  '/_site/articles': 'articles',
}

function SiteLayout() {
  const { user, isLoading, login, logout } = useAuth()
  const current = useMatches({
    select: (matches) =>
      matches.map((m) => CURRENT_BY_ROUTE[m.routeId]).find(Boolean),
  })
  return (
    <div className="flex min-h-screen flex-col bg-base">
      <SiteNav
        current={current}
        user={isLoading && !user ? undefined : user}
        onLogin={() => login()}
        onLogout={() => void logout()}
      />
      <main className="mx-auto w-full max-w-1040 flex-1 px-20 py-32 md:px-0">
        <Outlet />
      </main>
    </div>
  )
}
