import { useCallback, useMemo } from 'react'
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
import { readDraftEdit } from '@/hooks/useDraftEdit'
import {
  draftFieldsEqual,
  draftFieldsFromArgs,
  lookedUpArticles,
} from '@/lib/factCheckDraft'

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

  // Combine query error with state error if needed
  const error =
    data.error || (queryError instanceof Error ? queryError.message : null)

  /**
   * Send a new user message and start the SSE stream.
   * This immediately updates the global cache.
   *
   * If the user has unsent edits to the latest draft, they go along with the message so the AI
   * revises from the user's version (see `factCheckDraft.ts`). "Unsent" means different from
   * what was last sent for that draft, or from the AI's version if nothing was. The edits stay
   * in storage: if the message never reaches ADK, a reload still has them.
   */
  const sendMessage = useCallback(
    (text: string, files: Array<File> = []) => {
      const state = queryClient.getQueryData<ChatSessionState>(
        chatCacheKey(sessionId),
      )
      const draftId = state?.lastReplyDraftId
      const draft = draftId ? state.toolInvocations[draftId] : undefined
      let editedDraft
      if (draftId && draft?.name === 'draft_factcheck_response') {
        const edit = readDraftEdit(queryClient, sessionId, draftId)
        const base =
          state.sentDraftEdits[draftId] ?? draftFieldsFromArgs(draft.args)
        if (edit && !draftFieldsEqual(edit, base)) {
          editedDraft = { draftId, fields: edit }
        }
      }
      sendChatMessage(queryClient, sessionId, text, files, editedDraft)
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

  const articles = useMemo(
    () => lookedUpArticles(data.toolInvocations),
    [data.toolInvocations],
  )

  return {
    messages: data.messages,
    isStreaming: data.isStreaming,
    error,
    toolInvocations: data.toolInvocations,
    lastReplyDraftId: data.lastReplyDraftId,
    sentDraftEdits: data.sentDraftEdits,
    articles,
    sendMessage,
    resumeRun,
    stopGeneration,
  }
}
