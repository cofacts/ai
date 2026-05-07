import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SessionListItem } from '@/lib/chatSessions.functions'
import { useSessions } from '@/hooks/useSessions'
import { updateSession } from '@/lib/chatSessions.functions'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

interface SessionItemProps {
  session: SessionListItem
  isActive: boolean
  onClose: () => void
}

function SessionItem({ session, isActive, onClose }: SessionItemProps) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')

  const title = session.name
  const lastActivityTime = session.lastEventTime ?? 0
  const hasNew =
    !isActive &&
    lastActivityTime > 0 &&
    lastActivityTime > (session.lastOpenedAt ?? 0)

  const lastDisplayTime = session.lastEventTime ?? session.lastUpdateTime
  const lastActiveLabel = lastDisplayTime
    ? new Date(lastDisplayTime * 1000).toLocaleDateString('zh-TW', {
        month: 'short',
        day: 'numeric',
      })
    : '—'

  const handleStartEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsEditing(true)
    setEditTitle(title)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditTitle('')
  }

  const handleSaveEdit = async () => {
    const trimmedTitle = editTitle.trim()
    if (!trimmedTitle || trimmedTitle === title) {
      handleCancelEdit()
      return
    }

    try {
      await updateSession({
        data: {
          sessionId: session.id,
          name: trimmedTitle,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    } catch (err) {
      console.error('Failed to update session title:', err)
    } finally {
      handleCancelEdit()
    }
  }

  return (
    <div className="relative group">
      {isEditing ? (
        <div
          className={`flex flex-col p-3 rounded-lg ${isActive ? 'bg-primary/10 text-text-main' : 'text-text-muted'}`}
        >
          <div className="flex-1 min-w-0 pr-6">
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleSaveEdit}
              onKeyDown={(e) => {
                // Blur triggers onBlur → handleSaveEdit, avoiding double invocation
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') handleCancelEdit()
              }}
              className="w-full text-sm font-medium bg-white border border-primary rounded px-1 outline-none"
            />
            <div className="text-xs text-text-muted truncate mt-0.5 text-left">
              {lastActiveLabel}
            </div>
          </div>
        </div>
      ) : (
        <Link
          to="/session/$sessionId"
          params={{ sessionId: session.id }}
          onClick={onClose}
          className={`
            flex flex-col p-3 rounded-lg transition-colors w-full
            ${isActive ? 'bg-primary/10 text-text-main' : 'hover:bg-gray-50 text-text-muted'}
          `}
        >
          <div className="flex-1 min-w-0 pr-6">
            <div className="flex items-center gap-1.5">
              {hasNew && (
                <span className="shrink-0 h-2 w-2 rounded-full bg-primary" />
              )}
              <div
                className={`text-sm font-medium truncate text-left ${!isActive ? 'group-hover:text-text-main' : ''}`}
              >
                {title}
              </div>
            </div>
            <div className="text-xs text-text-muted truncate mt-0.5 text-left">
              {lastActiveLabel}
            </div>
          </div>
        </Link>
      )}

      {!isEditing && (
        <button
          onClick={handleStartEdit}
          className="absolute right-2 top-3 p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-primary transition-opacity"
        >
          <span className="material-symbols-outlined text-sm">edit</span>
        </button>
      )}
    </div>
  )
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const params = useParams({ strict: false })
  const currentSessionId = (params as Record<string, string | undefined>)
    .sessionId

  const { data: rawSessions, isLoading } = useSessions()
  const sessions = rawSessions
    ?.slice()
    .sort((a, b) => (b.lastEventTime ?? 0) - (a.lastEventTime ?? 0))

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

          {sessions?.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={currentSessionId === session.id}
              onClose={onClose}
            />
          ))}
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
