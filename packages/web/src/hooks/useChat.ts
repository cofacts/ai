import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ChatSessionState} from '@/lib/chatCache';
import {
  INITIAL_CHAT_STATE,
  abortControllers,
  convertAdkSessionToChatState,
  sendChatMessage,
  startChatStream,
} from '@/lib/chatCache'
import { getSession } from '@/lib/api'

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
  const { data = INITIAL_CHAT_STATE, error: queryError } =
    useQuery<ChatSessionState>({
      queryKey,
      // When cache is cold (direct navigation), fetch from ADK.
      // If cache is populated (LandingPage -> Session), use it without refetch (staleTime: Infinity).
      queryFn: async () => {
        const session = await getSession(sessionId)
        return convertAdkSessionToChatState(session)
      },
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    })

  // Combine query error with state error if needed
  const error =
    data.error || (queryError instanceof Error ? queryError.message : null)

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
    error,
    draftResponse: data.draftResponse,
    sources: data.sources,
    sendMessage,
    resumeRun,
    stopGeneration,
  }
}
