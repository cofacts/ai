import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChatSessionState } from '@/lib/chatCache'
import {
  INITIAL_CHAT_STATE,
  abortControllers,
  chatCacheKey,
  convertAdkSessionToChatState,
  sendChatMessage,
  startChatStream,
} from '@/lib/chatCache'
import { getSession } from '@/lib/chatSessions.functions'
import { isSessionNotFoundError } from '@/lib/sessionNotFound'

interface UseChatOptions {
  sessionId: string
}

/**
 * Merges the chat-cache error with the session query's error, splitting out
 * session-not-found so it isn't also rendered as a generic connection-error
 * banner. Exported standalone (rather than inlined in the hook) so this
 * branch is unit-testable without rendering — this repo's Vite/Vitest setup
 * does not yet support rendering React components/hooks in tests.
 */
export function deriveChatError(
  dataError: string | null | undefined,
  queryError: unknown,
): { error: string | null; sessionNotFound: boolean } {
  const sessionNotFound = isSessionNotFoundError(queryError)
  const error =
    dataError ||
    (!sessionNotFound && queryError instanceof Error
      ? queryError.message
      : null)
  return { error, sessionNotFound }
}

/**
 * React hook for accessing the global chat state managed by TanStack Query.
 */
export function useChat({ sessionId }: UseChatOptions) {
  const queryClient = useQueryClient()
  const queryKey = chatCacheKey(sessionId)

  // Subscribe to the global store via TanStack Query
  const { data = INITIAL_CHAT_STATE, error: queryError } =
    useQuery<ChatSessionState>({
      queryKey,
      // When cache is cold (direct navigation), fetch from ADK.
      // If cache is populated (LandingPage -> Session), use it without refetch (staleTime: Infinity).
      queryFn: async () => {
        const session = await getSession({ data: sessionId })
        return convertAdkSessionToChatState(session)
      },
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    })

  const { error, sessionNotFound } = deriveChatError(data.error, queryError)

  /**
   * Send a new user message and start the SSE stream.
   * This immediately updates the global cache.
   */
  const sendMessage = useCallback(
    (text: string, files: Array<File> = []) => {
      sendChatMessage(queryClient, sessionId, text, files)
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
        payload: { invocationId: invocationId },
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
    sessionNotFound,
    toolInvocations: data.toolInvocations,
    lastReplyDraftId: data.lastReplyDraftId,
    sendMessage,
    resumeRun,
    stopGeneration,
  }
}
