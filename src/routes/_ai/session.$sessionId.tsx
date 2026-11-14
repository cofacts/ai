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
import { Button } from '@/components/ui/button'

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
    notice,
    interrupted,
    sendMessage,
    retry,
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
      // Writing session state while a run is going would kill the run
      // (StaleSessionError). The backend also refuses ({deferred: true}) when
      // a run started elsewhere holds the session; this effect runs again
      // once isStreaming turns false.
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
        {notice && (
          <div
            role="status"
            className="bg-surface-raised border-b border-border-control px-spacing-16 py-spacing-8 text-type-body-s text-text-secondary flex items-center gap-spacing-8"
          >
            <MaterialIcon name="notifications" size={24} />
            <span>{notice}</span>
          </div>
        )}
        {interrupted && (
          <div
            role="status"
            className="bg-surface-raised border-b border-border-control px-spacing-16 py-spacing-8 text-type-body-s text-text-secondary flex items-center gap-spacing-8"
          >
            <MaterialIcon name="warning" size={24} />
            <span>這次回覆中斷了，沒有完成。</span>
            <Button
              variant="outline"
              size="sm"
              iconStart="send"
              className="ml-auto"
              onClick={retry}
            >
              重新提問
            </Button>
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
