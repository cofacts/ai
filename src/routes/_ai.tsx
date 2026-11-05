import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useCallback, useId, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { Button } from '@/components/ui/button'
import { LoggedOutLanding } from '@/components/LoggedOutLanding'
import { useAuth } from '@/lib/auth'

/**
 * The Cofacts AI area: login gate, session sidebar, and the chat that scrolls inside its panels.
 *
 * Temporary location. `_ai` is a pathless layout, so the AI pages still live at `/` and
 * `/session/*` as on the old cofacts.ai. Track 5 moves this folder to `routes/ai/` (URLs become
 * `/ai/*`, kb Phase 3 §2.2 / §3.4); the old `/session/*` URLs then redirect there (Track 6).
 */
export const Route = createFileRoute('/_ai')({
  // The AI screens share the global nav (Penpot uses the same Nav there). The chat scrolls
  // inside its side panels, so the page is pinned to the viewport, and a footer below it could
  // never be scrolled to.
  staticData: { fillViewport: true, hideGlobalFooter: true },
  component: AppLayout,
})

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarId = useId()
  const { user } = useAuth()

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Mobile: the session sidebar is opened from here; the site menu is in the nav. */}
      {user && (
        <div className="flex items-center border-b border-border-subtle bg-surface-base px-spacing-20 py-spacing-8 md:hidden">
          <Button
            variant="outline"
            size="icon-touch"
            iconStart="side_navigation"
            aria-label="開啟對話列表"
            aria-expanded={sidebarOpen}
            aria-controls={sidebarId}
            onClick={toggleSidebar}
          />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden bg-surface-base">
        {!user ? (
          <LoggedOutLanding />
        ) : (
          <>
            {/* Sidebar - Desktop: always visible, Mobile: overlay */}
            <Sidebar
              id={sidebarId}
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
