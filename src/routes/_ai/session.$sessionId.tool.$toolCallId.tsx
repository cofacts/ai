import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DraftLockReason } from '@/components/FactCheckDraftPanel'
import type { ToolInvocation } from '@/lib/adk'
import { useChat } from '@/hooks/useChat'
import { RightDrawer } from '@/components/RightDrawer'
import { useAuth } from '@/lib/auth'
import { draftTargetArticleIds } from '@/lib/factCheckDraft'
import { getMyArticleReplies } from '@/server/replies.functions'

export const Route = createFileRoute(
  '/_ai/session/$sessionId/tool/$toolCallId',
)({
  component: ToolDrawer,
})

/** Why a draft is read-only (see `factCheckDraft.ts`); null when it is the editable one. */
function draftLockReason(
  invocation: ToolInvocation | null,
  {
    lastReplyDraftId,
    isStreaming,
  }: { lastReplyDraftId: string | null; isStreaming: boolean },
): DraftLockReason {
  if (invocation?.name !== 'draft_factcheck_response') return null
  if (!invocation.resp) return 'streaming'
  if (!invocation.resp.success) return 'rejected'
  if (invocation.id !== lastReplyDraftId) return 'superseded'
  if (isStreaming) return 'streaming'
  return null
}

function ToolDrawer() {
  const { sessionId, toolCallId } = useParams({
    from: '/_ai/session/$sessionId/tool/$toolCallId',
  })
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const {
    toolInvocations,
    lastReplyDraftId,
    sentDraftEdits,
    isStreaming,
    articles,
  } = useChat({ sessionId })

  const handleClose = useCallback(() => {
    navigate({
      to: '/session/$sessionId',
      params: { sessionId },
      viewTransition: true,
    })
  }, [sessionId, navigate])

  const handleOpenLatestDraft = useCallback(() => {
    if (!lastReplyDraftId) return
    navigate({
      to: '/session/$sessionId/tool/$toolCallId',
      params: { sessionId, toolCallId: lastReplyDraftId },
      viewTransition: true,
      replace: true,
    })
  }, [sessionId, lastReplyDraftId, navigate])

  const invocation = toolInvocations[toolCallId] ?? null
  const lockReason = draftLockReason(invocation, {
    lastReplyDraftId,
    isStreaming,
  })
  const targetArticleIds =
    invocation?.name === 'draft_factcheck_response'
      ? draftTargetArticleIds(invocation.args, articles)
      : []

  // The user's own replies to the target articles, so the drawer can warn before a second one.
  // Only the editable draft can be submitted, so only it asks.
  const myRepliesKey = ['my-article-replies', ...targetArticleIds] as const
  const { data: myReplies = {} } = useQuery({
    queryKey: myRepliesKey,
    queryFn: () => getMyArticleReplies({ data: targetArticleIds }),
    enabled: !!user && lockReason === null && targetArticleIds.length > 0,
    staleTime: 60_000,
  })

  return (
    <RightDrawer
      isOpen={true}
      onClose={handleClose}
      invocation={invocation}
      draftContext={{
        sessionId,
        lockReason,
        sentEdit: sentDraftEdits[toolCallId] ?? null,
        targetArticleIds,
        articles,
        myReplies,
        onSubmitted: () =>
          queryClient.invalidateQueries({ queryKey: ['my-article-replies'] }),
        userName: user?.name ?? null,
        onOpenLatestDraft:
          lastReplyDraftId && lastReplyDraftId !== toolCallId
            ? handleOpenLatestDraft
            : undefined,
      }}
    />
  )
}
