import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { Header } from '@/components/Header'

export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <Header onToggleSidebar={toggleSidebar} />

      {/* Main content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar - Desktop: always visible, Mobile: overlay */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Chat Area (center) */}
        <section className="flex-1 flex flex-col bg-white min-w-0 relative overflow-hidden">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
