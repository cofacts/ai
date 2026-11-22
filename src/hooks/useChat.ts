import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatSessionState } from '@/lib/chatCache'
import {
  INITIAL_CHAT_STATE,
  chatCacheKey,
  connectSessionEvents,
  retryInterruptedTurn,
  sendChatMessage,
  stopRun,
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
  // The cache is filled by the session's live feed (below), or already by
  // the landing page's send; the query only subscribes to it.
  const { data = INITIAL_CHAT_STATE, error: queryError } =
    useQuery<ChatSessionState>({
      queryKey,
      queryFn: () => INITIAL_CHAT_STATE,
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    })

  // One live feed per session while anything shows it: the stored events,
  // then every run as it happens, including ones started in other windows.
  useEffect(() => {
    if (!sessionId) return
    return connectSessionEvents(queryClient, sessionId)
  }, [queryClient, sessionId])

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
    void stopRun(sessionId)
  }, [sessionId])

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
