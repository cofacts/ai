import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatSessionState } from '@/lib/chatCache'
import {
  INITIAL_CHAT_STATE,
  chatCacheKey,
  loadChatState,
  retryInterruptedTurn,
  sendChatMessage,
  stopRun,
  syncChatSession,
} from '@/lib/chatCache'

interface UseChatOptions {
  sessionId: string
}

/**
 * React hook for accessing the global chat state managed by TanStack Query.
 */
export function useChat({ sessionId }: UseChatOptions) {
  const queryClient = useQueryClient()
  const queryKey = chatCacheKey(sessionId)

  // Subscribe to the global store via TanStack Query
  const {
    data = INITIAL_CHAT_STATE,
    error: queryError,
    isSuccess,
  } = useQuery<ChatSessionState>({
    queryKey,
    // When cache is cold (direct navigation), fetch from ADK.
    // If cache is populated (LandingPage -> Session), use it without refetch (staleTime: Infinity).
    queryFn: () => loadChatState(sessionId),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // A run may be going without this tab watching it: started in another
  // window, or before this tab was closed and reopened. Look once when the
  // session is shown and whenever the tab becomes visible again; never poll.
  useEffect(() => {
    if (!sessionId || !isSuccess) return
    void syncChatSession(queryClient, sessionId)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void syncChatSession(queryClient, sessionId, { checkHistory: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [queryClient, sessionId, isSuccess])

  // Combine query error with state error if needed
  const error =
    data.error || (queryError instanceof Error ? queryError.message : null)

  /**
   * Send a new user message and start the run. Resolves to false when it
   * wasn't sent (another window's run holds the session).
   */
  const sendMessage = useCallback(
    (text: string, files: Array<File> = []) =>
      sendChatMessage(queryClient, sessionId, text, files),
    [queryClient, sessionId],
  )

  /** Ask the last question again after an interrupted turn. */
  const retry = useCallback(
    () => retryInterruptedTurn(queryClient, sessionId),
    [queryClient, sessionId],
  )

  /**
   * Stop generation for this session.
   */
  const stopGeneration = useCallback(() => {
    void stopRun(queryClient, sessionId)
  }, [queryClient, sessionId])

  return {
    messages: data.messages,
    isStreaming: data.isStreaming,
    error,
    notice: data.notice,
    interrupted: data.interrupted && !data.isStreaming,
    toolInvocations: data.toolInvocations,
    lastReplyDraftId: data.lastReplyDraftId,
    sendMessage,
    retry,
    stopGeneration,
  }
}
