import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { Header } from '@/components/Header'
import { Button } from '@/components/ui/button'
import { LoggedOutLanding } from '@/components/LoggedOutLanding'
import { useAuth } from '@/lib/auth'

export const Route = createFileRoute('/_app')({
  // The Cofacts AI screens draw their own header (AiNav) and have a side panel, so the
  // global nav and footer are off. When AI moves to /ai with the shared header (kb doc),
  // only the session screens keep hideGlobalFooter.
  staticData: { hideGlobalNav: true, hideGlobalFooter: true },
  component: AppLayout,
})

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user } = useAuth()

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <Header />

      {/* Mobile: the session sidebar is opened from here; the site menu is in the nav. */}
      {user && (
        <div className="flex items-center border-b border-subtle bg-base px-20 py-8 md:hidden">
          <Button
            variant="outline"
            size="icon-touch"
            iconStart="side-navigation"
            aria-label="開啟對話列表"
            aria-expanded={sidebarOpen}
            onClick={toggleSidebar}
          />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden bg-base">
        {!user ? (
          <LoggedOutLanding />
        ) : (
          <>
            {/* Sidebar - Desktop: always visible, Mobile: overlay */}
            <Sidebar
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />
            <Outlet />
          </>
        )}
      </main>
    </div>
  )
}
