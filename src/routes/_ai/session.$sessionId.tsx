import {
  Outlet,
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChatArea } from '@/components/ChatArea'
import { useChat } from '@/hooks/useChat'
import { markSessionOpened } from '@/lib/chatSessions.functions'
import { handleAuthExpired, isAuthExpiredError } from '@/lib/authExpired'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

export const Route = createFileRoute('/_ai/session/$sessionId')({
  component: SessionPage,
})

function SessionPage() {
  const { sessionId } = useParams({ from: '/_ai/session/$sessionId' })
  const { toolCallId } = useParams({ strict: false })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    stopGeneration,
    lastReplyDraftId,
    toolInvocations,
  } = useChat({ sessionId })

  const openedCallIds = useRef<Set<string>>(new Set())

  /** Opens a tool call (or a draft) in the right drawer. */
  const handleOpenDraft = useCallback(
    (id: string) => {
      navigate({
        to: '/session/$sessionId/tool/$toolCallId',
        params: { sessionId, toolCallId: id },
        viewTransition: true,
        replace: toolCallId !== undefined,
      })
    },
    [sessionId, toolCallId, navigate],
  )

  const handleToolBadgeClick = useCallback(
    (id: string) => {
      if (toolCallId !== id) return handleOpenDraft(id)
      navigate({
        to: '/session/$sessionId',
        params: { sessionId },
        viewTransition: true,
        replace: true,
      })
    },
    [toolCallId, sessionId, navigate, handleOpenDraft],
  )

  // Auto-open: lastReplyDraftId is pre-computed by the cache reducer
  useEffect(() => {
    if (toolCallId !== undefined) return
    if (!lastReplyDraftId) return
    if (openedCallIds.current.has(lastReplyDraftId)) return

    openedCallIds.current.add(lastReplyDraftId)
    navigate({
      to: '/session/$sessionId/tool/$toolCallId',
      params: { sessionId, toolCallId: lastReplyDraftId },
      viewTransition: true,
      replace: true,
    })
  }, [lastReplyDraftId, toolCallId, sessionId, navigate])

  // When a newer draft arrives while the previous latest is open in the drawer (typically the one
  // the user just sent edits from), switch to it, so the user lands on the draft they can edit.
  const prevLatestDraftId = useRef(lastReplyDraftId)
  useEffect(() => {
    const prev = prevLatestDraftId.current
    prevLatestDraftId.current = lastReplyDraftId
    if (!lastReplyDraftId || prev === lastReplyDraftId) return
    if (!toolCallId || toolCallId !== prev) return
    openedCallIds.current.add(lastReplyDraftId)
    navigate({
      to: '/session/$sessionId/tool/$toolCallId',
      params: { sessionId, toolCallId: lastReplyDraftId },
      viewTransition: true,
      replace: true,
    })
  }, [lastReplyDraftId, toolCallId, sessionId, navigate])

  useEffect(() => {
    if (isStreaming) {
      // Don't trigger ADK state update when streaming;
      // otherwise when the stream ends, the session will be stale.
      return
    }
    markSessionOpened({ data: sessionId })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      })
      .catch((err) => {
        if (isAuthExpiredError(err)) handleAuthExpired()
      })
  }, [sessionId, queryClient, isStreaming])

  return (
    <>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {error && (
          <div className="bg-surface-raised border-b border-border-control px-spacing-16 py-spacing-8 text-type-body-s text-status-incorrect flex items-center gap-spacing-8">
            <MaterialIcon name="error" size={24} />
            <span>連線錯誤: {error}</span>
            <button
              onClick={() => window.location.reload()}
              className="ml-auto text-type-caption text-status-incorrect hover:text-status-incorrect underline"
            >
              重新整理
            </button>
          </div>
        )}
        <ChatArea
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={sendMessage}
          onStop={stopGeneration}
          sessionId={sessionId}
          focusedToolCallId={toolCallId ?? null}
          onToolBadgeClick={handleToolBadgeClick}
          toolInvocations={toolInvocations}
          onOpenDraft={handleOpenDraft}
          latestDraftId={lastReplyDraftId}
        />
      </div>
      <Outlet />
    </>
  )
}
