import { Link, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatSessionState } from '@/lib/chatCache'
import type { SessionListItem } from '@/lib/chatSessions.functions'
import { chatCacheKey } from '@/lib/chatCache'
import { useSessions } from '@/hooks/useSessions'
import { updateSessionTitle } from '@/lib/chatSessions.functions'
import { handleAuthExpired, isAuthExpiredError } from '@/lib/authExpired'
import { Icon } from '@/components/ui/icon'

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
          className={`flex flex-col p-spacing-12 rounded-radius-10 ${isActive ? 'bg-surface-accent-subtle text-text-on-accent' : 'text-text-secondary'}`}
        >
          <div className="flex-1 min-w-0 pr-spacing-24">
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
              className="w-full text-type-body-s bg-surface-base border border-border-accent rounded-radius-5 px-spacing-4 outline-none"
            />
            <div
              className={`text-type-caption truncate mt-spacing-2 text-left ${isActive ? '' : 'text-text-secondary'}`}
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
            flex flex-col p-spacing-12 rounded-radius-10 transition-colors w-full
            ${isActive ? 'bg-surface-accent-subtle text-text-on-accent' : 'hover:bg-surface-raised text-text-secondary'}
          `}
        >
          <div className="flex-1 min-w-0 pr-spacing-24">
            <div className="flex items-center gap-[6px]">
              {hasNew && (
                <span className="shrink-0 h-spacing-8 w-spacing-8 rounded-full bg-surface-accent" />
              )}
              <div
                className={`text-type-body-s truncate text-left ${!isActive ? 'group-hover:text-text-primary' : ''}`}
              >
                {title}
              </div>
            </div>
            <div
              className={`text-type-caption truncate mt-spacing-2 text-left ${isActive ? '' : 'text-text-secondary'}`}
            >
              {lastActiveLabel}
            </div>
          </div>
        </Link>
      )}

      {!isEditing && !isStreaming && (
        <button
          onClick={handleStartEdit}
          className="absolute right-spacing-8 top-spacing-12 p-spacing-4 opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-text-primary transition-opacity"
        >
          <Icon name="edit" size={24} />
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
          className="fixed inset-0 bg-overlay-scrim z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          w-[256px] bg-surface-base border-r border-border-subtle flex flex-col shrink-0 z-50
          fixed inset-y-0 left-0 transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* New session button */}
        <div className="p-spacing-16">
          <Link
            to="/"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-spacing-8 bg-surface-base hover:bg-surface-accent-subtle text-text-primary hover:text-text-on-accent py-[10px] px-spacing-16 rounded-radius-10 transition-colors border border-border-accent"
          >
            <Icon name="add" size={24} />
            <span>新查核任務</span>
          </Link>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-spacing-8 space-y-spacing-4 pb-spacing-16">
          <div className="px-spacing-12 py-spacing-8 text-type-caption font-bold text-text-tertiary uppercase mt-spacing-8">
            查核紀錄
          </div>

          {isLoading && (
            <div className="space-y-spacing-4 px-spacing-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-[56px] rounded-radius-10 bg-surface-raised animate-pulse"
                />
              ))}
            </div>
          )}

          {!isLoading && (!sessions || sessions.length === 0) && (
            <div className="px-spacing-12 py-spacing-16 text-type-body-s text-text-secondary text-center">
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
        <div className="p-spacing-16 border-t border-border-subtle bg-surface-raised">
          <div className="flex items-center gap-spacing-12 text-type-body-s text-text-secondary hover:text-text-primary cursor-pointer">
            <Icon name="help" size={24} />
            <span>使用教學與支援</span>
          </div>
        </div>
      </aside>
    </>
  )
}
