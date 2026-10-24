import { SiteNav } from '@/components/SiteNav'
import { useAuth } from '@/lib/auth'

/**
 * The Cofacts AI header. Penpot uses the same Nav (Type = Default) on the AI pages as on the
 * rest of the site, so this is SiteNav with 問問 AI as the current item.
 */
export function Header() {
  const { user, isLoading, login, logout } = useAuth()
  return (
    <SiteNav
      current="ai"
      user={isLoading && !user ? undefined : user}
      onLogin={() => login()}
      onLogout={() => void logout()}
    />
  )
}
