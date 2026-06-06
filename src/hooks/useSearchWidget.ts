import { useQuery } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import { getSearchWidget } from '@/lib/chatSessions.functions'

/**
 * Fetches the Google Search suggestion-pills HTML for a single investigator
 * tool-call. The artifact is only written once the investigator call completes,
 * so we wait for the tool-call's response to land (tracked in the chat state's
 * `toolInvocations`) before fetching.
 *
 * Returns `html` as the decoded HTML string, or `null` when there is no widget
 * for this call.
 */
export function useSearchWidget(sessionId: string, toolCallId: string) {
  const { toolInvocations } = useChat({ sessionId })
  // The widget artifact is only written once the investigator response lands;
  // the tool-call id is absent from the map until then.
  const hasResponse =
    toolCallId in toolInvocations && toolInvocations[toolCallId].resp != null

  const { data } = useQuery({
    queryKey: ['search-widget', sessionId, toolCallId],
    queryFn: () => getSearchWidget({ data: { sessionId, toolCallId } }),
    enabled: hasResponse,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return data ?? null
}
