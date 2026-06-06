import { useQuery } from '@tanstack/react-query'
import { getSearchWidget } from '@/lib/chatSessions.functions'

/**
 * Fetches the Google Search suggestion-pills HTML for a single investigator
 * tool-call. The artifact is only written once the investigator call completes,
 * so callers should pass `enabled` = "this investigator call has a response".
 *
 * Returns `html` as the decoded HTML string, or `null`/`undefined` when there is
 * no widget for this call.
 */
export function useSearchWidget(
  sessionId: string | undefined,
  toolCallId: string | undefined,
  enabled: boolean,
) {
  const { data } = useQuery({
    queryKey: ['search-widget', sessionId, toolCallId],
    queryFn: () =>
      getSearchWidget({
        data: { sessionId: sessionId!, toolCallId: toolCallId! },
      }),
    enabled: enabled && !!sessionId && !!toolCallId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  return data ?? null
}
