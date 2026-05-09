import { useQuery } from '@tanstack/react-query'
import type { SessionListItem } from '@/lib/chatSessions.functions'
import { listSessions } from '@/lib/chatSessions.functions'

export function useSessions() {
  return useQuery<Array<SessionListItem>>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    staleTime: 30_000,
    gcTime: Infinity,
  })
}
