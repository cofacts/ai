import { useQuery } from '@tanstack/react-query'
import type { AdkSession } from '@/lib/adk'
import { listSessions } from '@/lib/api'

export function useSessions() {
  return useQuery<Array<AdkSession>>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    staleTime: 30_000,
    gcTime: Infinity,
  })
}

/** Derives a human-readable title from the first user message in a session's events */
export function getSessionTitle(session: AdkSession): string {
  const firstUserEvent = session.events?.find(
    (e) => e.content?.role === 'user' && e.content.parts?.[0]?.text,
  )
  return firstUserEvent?.content?.parts?.[0]?.text?.slice(0, 40) ?? session.id
}
