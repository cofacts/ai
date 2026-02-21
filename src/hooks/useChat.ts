import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  INITIAL_CHAT_STATE,
  ChatSessionState,
  sendChatMessage,
  startChatStream,
  abortControllers,
} from '@/lib/chatCache'

interface UseChatOptions {
  sessionId: string
}

/**
 * React hook for accessing the global chat state managed by TanStack Query.
 */
export function useChat({ sessionId }: UseChatOptions) {
  const queryClient = useQueryClient()
  const queryKey = ['chat', sessionId]

  // Subscribe to the global store via TanStack Query
  const { data = INITIAL_CHAT_STATE } = useQuery<ChatSessionState>({
    queryKey,
    // Returns the initial empty state when the cache is cold (e.g., after a
    // page refresh). Real data is pushed via queryClient.setQueryData() from
    // the SSE stream, so this queryFn is only called when there is nothing
    // in the cache yet.
    queryFn: () => INITIAL_CHAT_STATE,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  /**
   * Send a new user message and start the SSE stream.
   * This immediately updates the global cache.
   */
  const sendMessage = useCallback(
    (text: string) => {
      sendChatMessage(queryClient, sessionId, text)
    },
    [queryClient, sessionId],
  )

  /**
   * Resume an interrupted run by invocation ID.
   */
  const resumeRun = useCallback(
    (invocationId: string) => {
      startChatStream({
        queryClient,
        sessionId,
        payload: { invocation_id: invocationId },
      })
    },
    [queryClient, sessionId],
  )

  /**
   * Stop generation for this session.
   */
  const stopGeneration = useCallback(() => {
    abortControllers.get(sessionId)?.abort()
  }, [sessionId])

  return {
    messages: data.messages,
    isStreaming: data.isStreaming,
    error: data.error,
    draftResponse: data.draftResponse,
    sources: data.sources,
    sendMessage,
    resumeRun,
    stopGeneration,
  }
}
