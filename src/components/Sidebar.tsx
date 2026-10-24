import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatSessionState } from '@/lib/chatCache'
import type { SessionListItem } from '@/lib/chatSessions.functions'
import { chatCacheKey } from '@/lib/chatCache'
import { useSessions } from '@/hooks/useSessions'
import { updateSessionTitle } from '@/lib/chatSessions.functions'
import { handleAuthExpired, isAuthExpiredError } from '@/lib/authExpired'

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
  const { title, lastEventTime, lastOpenedAt, lastUpdateTime } = session

  // The session title is written to ADK state after the first turn finishes. A rename
  // issued while that write is still in flight would be lost to the last-write-wins
  // state merge, so the rename affordance stays hidden until the stream ends.
  // Read-only subscription: `enabled: false` means the sidebar never fetches, it only
  // observes the chat cache that useChat maintains.
  const { data: chatState } = useQuery<ChatSessionState>({
    queryKey: chatCacheKey(session.id),
    enabled: false,
  })
  const isStreaming = chatState?.isStreaming ?? false

  const hasNew =
    !isActive &&
    lastEventTime !== undefined &&
    lastEventTime > (lastOpenedAt ?? lastUpdateTime)

  const lastActiveLabel =
    lastEventTime !== undefined
      ? new Date(lastEventTime * 1000).toLocaleDateString('zh-TW', {
          month: 'short',
          day: 'numeric',
        })
      : '—'

  const handleStartEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isStreaming) return
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
      await updateSessionTitle({
        data: {
          sessionId: session.id,
          title: trimmedTitle,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    } catch (err) {
      if (isAuthExpiredError(err)) {
        handleAuthExpired()
      } else {
        console.error('Failed to update session title:', err)
      }
    } finally {
      handleCancelEdit()
    }
  }

  return (
    <div className="relative group">
      {isEditing ? (
        <div
          className={`flex flex-col p-12 rounded-10 ${isActive ? 'bg-accent-subtle text-on-accent' : 'text-secondary'}`}
        >
          <div className="flex-1 min-w-0 pr-24">
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
              className="w-full text-body-s bg-base border border-accent rounded-5 px-4 outline-none"
            />
            <div
              className={`text-caption truncate mt-2 text-left ${isActive ? '' : 'text-secondary'}`}
            >
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
            flex flex-col p-12 rounded-10 transition-colors w-full
            ${isActive ? 'bg-accent-subtle text-on-accent' : 'hover:bg-raised text-secondary'}
          `}
        >
          <div className="flex-1 min-w-0 pr-24">
            <div className="flex items-center gap-6">
              {hasNew && (
                <span className="shrink-0 h-8 w-8 rounded-full bg-accent" />
              )}
              <div
                className={`text-body-s truncate text-left ${!isActive ? 'group-hover:text-primary' : ''}`}
              >
                {title}
              </div>
            </div>
            <div
              className={`text-caption truncate mt-2 text-left ${isActive ? '' : 'text-secondary'}`}
            >
              {lastActiveLabel}
            </div>
          </div>
        </Link>
      )}

      {!isEditing && !isStreaming && (
        <button
          onClick={handleStartEdit}
          className="absolute right-8 top-12 p-4 opacity-0 group-hover:opacity-100 text-tertiary hover:text-primary transition-opacity"
        >
          <span className="material-symbols-outlined text-body-s">edit</span>
        </button>
      )}
    </div>
  )
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
          className="fixed inset-0 bg-scrim z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          w-256 bg-base border-r border-subtle flex flex-col shrink-0 z-50
          fixed inset-y-0 left-0 transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* New session button */}
        <div className="p-16">
          <Link
            to="/"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-8 bg-base hover:bg-accent-subtle text-primary hover:text-on-accent py-10 px-16 rounded-10 transition-colors border border-accent"
          >
            <span className="material-symbols-outlined text-body-s">add</span>
            <span>新查核任務</span>
          </Link>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-8 space-y-4 pb-16">
          <div className="px-12 py-8 text-caption font-bold text-tertiary uppercase mt-8">
            查核紀錄
          </div>

          {isLoading && (
            <div className="space-y-4 px-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-56 rounded-10 bg-raised animate-pulse"
                />
              ))}
            </div>
          )}

          {!isLoading && (!sessions || sessions.length === 0) && (
            <div className="px-12 py-16 text-body-s text-secondary text-center">
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
        <div className="p-16 border-t border-subtle bg-raised">
          <div className="flex items-center gap-12 text-body-s text-secondary hover:text-primary cursor-pointer">
            <span className="material-symbols-outlined">help</span>
            <span>使用教學與支援</span>
          </div>
        </div>
      </aside>
    </>
  )
}
