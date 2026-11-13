import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { DraftFields } from '@/lib/factCheckDraft'

/**
 * Per-draft client state for the editable fact-check draft: the user's unsent edits, and the
 * Cofacts reply id once it is submitted. Both live in the TanStack Query cache (so the drawer
 * and the chat input see the same value) and are mirrored to localStorage so a reload doesn't
 * lose half-written edits or offer to submit the same draft twice. Storage is best-effort:
 * private windows and blocked storage just fall back to the in-memory cache.
 */

const editKey = (sessionId: string, draftId: string) =>
  ['draft-edit', sessionId, draftId] as const
const submittedKey = (sessionId: string, draftId: string) =>
  ['draft-submitted', sessionId, draftId] as const

const storageKey = (kind: string, sessionId: string, draftId: string) =>
  `cofacts-ai:${kind}:${sessionId}:${draftId}`

function load<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable — the cache still holds the value for this page view.
  }
}

/** The user's unsent edits to a draft, or null when they haven't changed it. */
export function readDraftEdit(
  queryClient: QueryClient,
  sessionId: string,
  draftId: string,
): DraftFields | null {
  const cached = queryClient.getQueryData<DraftFields | null>(
    editKey(sessionId, draftId),
  )
  if (cached !== undefined) return cached
  return typeof window === 'undefined'
    ? null
    : load<DraftFields>(storageKey('draft-edit', sessionId, draftId))
}

export function writeDraftEdit(
  queryClient: QueryClient,
  sessionId: string,
  draftId: string,
  fields: DraftFields | null,
) {
  queryClient.setQueryData(editKey(sessionId, draftId), fields)
  save(storageKey('draft-edit', sessionId, draftId), fields)
}

export function useDraftEdit(sessionId: string, draftId: string) {
  const queryClient = useQueryClient()
  const { data = null } = useQuery({
    queryKey: editKey(sessionId, draftId),
    queryFn: () =>
      load<DraftFields>(storageKey('draft-edit', sessionId, draftId)),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const setEdit = useCallback(
    (fields: DraftFields | null) =>
      writeDraftEdit(queryClient, sessionId, draftId, fields),
    [queryClient, sessionId, draftId],
  )
  return [data, setEdit] as const
}

/** The Cofacts reply id this draft was submitted as, or null. */
export function useSubmittedReply(sessionId: string, draftId: string) {
  const queryClient = useQueryClient()
  const { data = null } = useQuery({
    queryKey: submittedKey(sessionId, draftId),
    queryFn: () =>
      load<string>(storageKey('draft-submitted', sessionId, draftId)),
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const setSubmitted = useCallback(
    (replyId: string) => {
      queryClient.setQueryData(submittedKey(sessionId, draftId), replyId)
      save(storageKey('draft-submitted', sessionId, draftId), replyId)
    },
    [queryClient, sessionId, draftId],
  )
  return [data, setSubmitted] as const
}
