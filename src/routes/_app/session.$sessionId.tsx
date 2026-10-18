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

export const Route = createFileRoute('/_app/session/$sessionId')({
  component: SessionPage,
})

function SessionPage() {
  const { sessionId } = useParams({ from: '/_app/session/$sessionId' })
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
  } = useChat({ sessionId })

  const openedCallIds = useRef<Set<string>>(new Set())

  const handleToolBadgeClick = useCallback(
    (id: string) => {
      if (toolCallId === id) {
        navigate({
          to: '/session/$sessionId',
          params: { sessionId },
          viewTransition: true,
          replace: true,
        })
        return
      }
      navigate({
        to: '/session/$sessionId/tool/$toolCallId',
        params: { sessionId, toolCallId: id },
        viewTransition: true,
        replace: toolCallId !== undefined,
      })
    },
    [toolCallId, sessionId, navigate],
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
          <div className="bg-raised border-b border-control px-16 py-8 text-body-s text-status-incorrect flex items-center gap-8">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>連線錯誤: {error}</span>
            <button
              onClick={() => window.location.reload()}
              className="ml-auto text-caption text-status-incorrect hover:text-status-incorrect underline"
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
        />
      </div>
      <Outlet />
    </>
  )
}
