import { useQuery } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import { getSearchWidget } from '@/lib/chatSessions.functions'

/**
 * Fetches the Google Search suggestion-pills HTML for a single investigator
 * tool-call. The artifact is only written once the investigator call completes,
 * so we wait for the tool-call's response to land (tracked in the chat state's
 * `toolInvocations`) before fetching.
 *
 * Returns `html` as the decoded HTML string, or `null`/`undefined` when there is
 * no widget for this call.
 */
export function useSearchWidget(
  sessionId: string | undefined,
  toolCallId: string | undefined,
) {
  const { toolInvocations } = useChat({ sessionId: sessionId ?? '' })
  const invocation = toolCallId ? toolInvocations[toolCallId] : undefined
  const hasResponse = invocation?.resp != null

  const { data } = useQuery({
    queryKey: ['search-widget', sessionId, toolCallId],
    queryFn: () =>
      getSearchWidget({
        data: { sessionId: sessionId!, toolCallId: toolCallId! },
      }),
    enabled: hasResponse && !!sessionId && !!toolCallId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return data ?? null
}
