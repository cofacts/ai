import { useQuery } from '@tanstack/react-query'
import type { AdkSession } from '@/lib/adk'
import { SESSION_TITLE_KEY, listSessions } from '@/lib/sessions.functions'

export function useSessions() {
  return useQuery<Array<AdkSession>>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    staleTime: 30_000,
    gcTime: Infinity,
  })
}

/** Derives a human-readable title from the session state or first user message */
export function getSessionTitle(session: AdkSession): string {
  // 1. Prefer explicit title from session state
  const stateTitle = session.state?.[SESSION_TITLE_KEY]
  if (typeof stateTitle === 'string' && stateTitle) {
    return stateTitle
  }

  // 2. Fallback to deriving from first user message
  const firstUserEvent = session.events?.find(
    (e) => e.content?.role === 'user' && e.content.parts?.[0]?.text,
  )
  return firstUserEvent?.content?.parts?.[0]?.text?.slice(0, 40) ?? session.id
}
