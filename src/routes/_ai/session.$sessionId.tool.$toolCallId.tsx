import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { DraftLockReason } from '@/components/FactCheckDraftPanel'
import type { ToolInvocation } from '@/lib/adk'
import { useChat } from '@/hooks/useChat'
import { RightDrawer } from '@/components/RightDrawer'

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
    lockedDraftIds,
    isStreaming,
  }: {
    lastReplyDraftId: string | null
    lockedDraftIds: Array<string>
    isStreaming: boolean
  },
): DraftLockReason {
  if (invocation?.name !== 'draft_factcheck_response') return null
  if (!invocation.resp) return 'streaming'
  if (!invocation.resp.success) return 'rejected'
  if (invocation.id !== lastReplyDraftId) return 'superseded'
  if (lockedDraftIds.includes(invocation.id)) return 'sent'
  if (isStreaming) return 'streaming'
  return null
}

function ToolDrawer() {
  const { sessionId, toolCallId } = useParams({
    from: '/_ai/session/$sessionId/tool/$toolCallId',
  })
  const navigate = useNavigate()
  const {
    toolInvocations,
    lastReplyDraftId,
    lockedDraftIds,
    isStreaming,
    articleId,
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
    lockedDraftIds,
    isStreaming,
  })

  return (
    <RightDrawer
      isOpen={true}
      onClose={handleClose}
      invocation={invocation}
      draftContext={{
        sessionId,
        lockReason,
        articleId,
        onOpenLatestDraft:
          lastReplyDraftId &&
          lastReplyDraftId !== toolCallId &&
          !lockedDraftIds.includes(lastReplyDraftId)
            ? handleOpenLatestDraft
            : undefined,
      }}
    />
  )
}
