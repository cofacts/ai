import { AiNav } from '@/components/SiteNav'
import { useAuth } from '@/lib/auth'

interface HeaderProps {
  onToggleSidebar: () => void
}

/** The Cofacts AI header: AiNav wired to the session. */
export function Header({ onToggleSidebar }: HeaderProps) {
  const { user, isLoading, login, logout } = useAuth()
  return (
    <AiNav
      user={isLoading && !user ? undefined : user}
      onLogin={() => login()}
      onLogout={() => void logout()}
      onToggleSidebar={onToggleSidebar}
    />
  )
}
