import { Link, useParams } from '@tanstack/react-router'
import { useSessions, getSessionTitle } from '@/hooks/useSessions'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const params = useParams({ strict: false })
  const currentSessionId = (params as Record<string, string | undefined>)
    .sessionId

  const { data: sessions, isLoading } = useSessions()

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          w-64 bg-white border-r border-border-subtle flex flex-col shrink-0 z-50
          fixed inset-y-0 left-0 transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* New session button */}
        <div className="p-4">
          <Link
            to="/"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 bg-white hover:bg-orange-50 text-primary font-medium py-2.5 px-4 rounded-lg transition-colors border border-primary"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            <span>新查核任務</span>
          </Link>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-1 pb-4">
          <div className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-wider mt-2">
            查核紀錄
          </div>

          {isLoading && (
            <div className="space-y-1 px-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-lg bg-gray-100 animate-pulse"
                />
              ))}
            </div>
          )}

          {!isLoading && (!sessions || sessions.length === 0) && (
            <div className="px-3 py-4 text-sm text-text-muted text-center">
              尚無查核任務
            </div>
          )}

          {sessions?.map((session) => {
            const isActive = currentSessionId === session.id
            const title = getSessionTitle(session)
            return (
              <Link
                key={session.id}
                to="/session/$sessionId"
                params={{ sessionId: session.id }}
                onClick={onClose}
                className={`
                  flex flex-col p-3 rounded-lg group transition-colors
                  ${isActive ? 'bg-primary/10 text-text-main' : 'hover:bg-gray-50 text-text-muted'}
                `}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium truncate text-left ${!isActive ? 'group-hover:text-text-main' : ''}`}
                  >
                    {title}
                  </div>
                  <div className="text-xs text-text-muted truncate mt-0.5 text-left font-mono">
                    {session.id.slice(0, 8)}…
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle bg-gray-50">
          <div className="flex items-center gap-3 text-sm text-text-muted hover:text-text-main cursor-pointer">
            <span className="material-symbols-outlined">help</span>
            <span>使用教學與支援</span>
          </div>
        </div>
      </aside>
    </>
  )
}
