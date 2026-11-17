import { useEffect, useId, useRef, useState } from 'react'

import type { ReactionGroupProps, ReplyVote } from '@/components/ReactionGroup'
import type { CofactsUser } from '@/lib/auth'
import { ReactionGroup } from '@/components/ReactionGroup'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle } from '@/components/ui/popover'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { UserAvatar } from '@/components/UserAvatar'
import { cn } from '@/lib/utils'

/** One user's feedback on a reply: the vote and, usually, why. */
export type ReplyFeedbackReason = {
  id: string
  vote: 'UPVOTE' | 'DOWNVOTE'
  comment?: string | null
  /** ISO 8601. Only used for ordering. */
  createdAt: string
  user: Pick<
    CofactsUser,
    'name' | 'avatarUrl' | 'avatarType' | 'avatarData'
  > | null
  /** Link that reports this comment as abuse. Leave it out when the viewer can't report it. */
  reportHref?: string
}

/** What `onSubmitVote` receives. NEUTRAL takes a vote back. */
export type ReplyFeedbackVote =
  | { vote: 'UPVOTE' | 'DOWNVOTE'; comment: string }
  | { vote: 'NEUTRAL' }

export type ReplyFeedbackProps = Pick<
  ReactionGroupProps,
  'type' | 'positiveCount' | 'negativeCount' | 'ownVote' | 'voteDisabled'
> & {
  /**
   * Sends the vote. Resolve when it is saved: the reason form then closes and the thanks shows.
   * Reject when it fails: the form stays open with the comment, so the user can send again.
   * The parent owns the vote: `ownVote` changes only once it is saved.
   */
  onSubmitVote: (input: ReplyFeedbackVote) => Promise<void>
  /**
   * What 看理由 lists. The parent fetches it: `onLoadReasons` is called each time the list opens
   * (and on 重試), and `reasons` follows the request. Only feedbacks with a comment are worth
   * fetching, but those without are shown too, as rumors-site does, after the ones with.
   */
  reasons?: {
    status: 'idle' | 'loading' | 'error' | 'success'
    feedbacks: Array<ReplyFeedbackReason>
  }
  onLoadReasons?: () => void
  className?: string
}

const hasComment = (reason: ReplyFeedbackReason) =>
  !!reason.comment && reason.comment.trim() !== ''

/**
 * The feedbacks of one vote, in the order rumors-site lists them: those with a comment first,
 * then the newest first. A comment of only whitespace counts as no comment.
 */
export function sortReasons(
  reasons: Array<ReplyFeedbackReason>,
  vote: ReplyFeedbackReason['vote'],
): Array<ReplyFeedbackReason> {
  return reasons
    .filter((reason) => reason.vote === vote)
    .sort(
      (a, b) =>
        Number(!hasComment(a)) - Number(!hasComment(b)) ||
        b.createdAt.localeCompare(a.createdAt),
    )
}

const REASON_TITLE = {
  UPVOTE: '還有什麼想補充的嗎？',
  DOWNVOTE: '為什麼你覺得沒有幫助？',
} as const

const THANKS_MS = 4000

/** rumors-site lists 10 reasons per vote, then 載入更多. */
const REASONS_PAGE = 10

const VOTE_LABEL = { UPVOTE: '有幫助', DOWNVOTE: '沒幫助' } as const

/** Report links come from the parent; only http(s) is ever a link. */
const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function ReasonList({
  vote,
  reasons,
  expanded,
  onExpand,
  onRetry,
}: {
  vote: 'UPVOTE' | 'DOWNVOTE'
  reasons: ReplyFeedbackProps['reasons']
  expanded: boolean
  onExpand: () => void
  onRetry?: () => void
}) {
  if (reasons?.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-spacing-8">
        <p role="alert" className="text-type-body-s text-status-incorrect">
          載入失敗。
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重試
        </Button>
      </div>
    )
  }
  if (!reasons || reasons.status !== 'success') {
    return (
      <p role="status" className="text-type-body-s text-text-secondary">
        載入中…
      </p>
    )
  }

  const sorted = sortReasons(reasons.feedbacks, vote)
  if (sorted.length === 0) {
    return (
      <p className="text-type-body-s text-text-secondary">
        還沒有人留下{VOTE_LABEL[vote]}的理由。
      </p>
    )
  }
  const shown = expanded ? sorted : sorted.slice(0, REASONS_PAGE)

  return (
    <div className="flex flex-col gap-spacing-8">
      {/* A scrolling area has to be reachable by keyboard, so it is focusable. */}
      <div
        role="region"
        aria-label={`${VOTE_LABEL[vote]}的理由`}
        tabIndex={0}
        className="max-h-[300px] overflow-y-auto overscroll-contain"
      >
        <ul className="flex flex-col">
          {shown.map((reason) => (
            <li
              key={reason.id}
              className="flex gap-spacing-12 border-b border-border-subtle py-spacing-12 last:border-b-0"
            >
              {reason.user && <UserAvatar user={reason.user} size={36} />}
              <div className="flex min-w-0 flex-1 flex-col gap-spacing-4">
                <span className="text-type-ui-s-bold text-text-primary">
                  {reason.user?.name}
                </span>
                {hasComment(reason) && (
                  <p className="text-type-body-s [overflow-wrap:anywhere] whitespace-pre-wrap text-text-primary">
                    {reason.comment?.trim()}
                  </p>
                )}
                {hasComment(reason) &&
                  reason.reportHref &&
                  isHttpUrl(reason.reportHref) && (
                    <a
                      href={reason.reportHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="檢舉這則理由（另開新分頁）"
                      className="self-start text-type-ui-xs text-text-link underline"
                    >
                      檢舉
                    </a>
                  )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {!expanded && sorted.length > REASONS_PAGE && (
        <Button variant="outline" size="sm" onClick={onExpand}>
          載入更多
        </Button>
      )}
    </div>
  )
}

/**
 * Penpot [Feedback/ReactionGroup](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=f402ced6-616c-80b4-8008-6d275a72b495)
 * with the behavior Penpot doesn't draw, ported from rumors-site's `ArticleReplyFeedbackControl`.
 * A vote asks for a reason before it is sent; pressing the vote you gave takes it back at once.
 *
 * Presentational: the parent saves the votes (`onSubmitVote`) and owns `ownVote`.
 */
export function ReplyFeedback({
  onSubmitVote,
  voteDisabled,
  reasons,
  onLoadReasons,
  className,
  ...groupProps
}: ReplyFeedbackProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const textareaId = useId()
  const titleId = useId()

  /** The vote waiting for its reason. The form is open while this is set. */
  const [pending, setPending] = useState<'UPVOTE' | 'DOWNVOTE' | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [thanks, setThanks] = useState(false)
  const [reasonsOpen, setReasonsOpen] = useState(false)
  const [reasonsTab, setReasonsTab] = useState<'UPVOTE' | 'DOWNVOTE'>('UPVOTE')
  const [expanded, setExpanded] = useState({ UPVOTE: false, DOWNVOTE: false })

  useEffect(() => {
    if (!thanks) return
    const timer = setTimeout(() => setThanks(false), THANKS_MS)
    return () => clearTimeout(timer)
  }, [thanks])

  const submit = async (input: ReplyFeedbackVote) => {
    setSubmitting(true)
    setFailed(false)
    try {
      await onSubmitVote(input)
      setPending(null)
      setComment('')
      setThanks(input.vote !== 'NEUTRAL')
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleVote = (vote: ReplyVote) => {
    if (vote === 'NEUTRAL') {
      void submit({ vote })
      return
    }
    setComment('')
    setFailed(false)
    setThanks(false)
    setPending(vote)
  }

  const handleShowReasons = () => {
    setPending(null)
    setExpanded({ UPVOTE: false, DOWNVOTE: false })
    setReasonsOpen(true)
    onLoadReasons?.()
  }

  const failedMessage = (
    <p role="alert" className="text-type-caption text-status-incorrect">
      送出失敗，請稍後再試。
    </p>
  )

  return (
    <div
      ref={anchorRef}
      className={cn('flex flex-col gap-spacing-4 md:items-start', className)}
    >
      <ReactionGroup
        {...groupProps}
        voteDisabled={voteDisabled || submitting}
        onVote={handleVote}
        onShowReasons={handleShowReasons}
      />
      {/* Always in the page, so that a screen reader announces the text when it appears. */}
      <div role="status" className="text-type-caption text-text-secondary">
        {thanks ? '感謝你的回饋' : null}
      </div>
      {failed && !pending && failedMessage}
      <Popover
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <PopoverContent anchor={anchorRef} align="start">
          {pending && (
            <form
              className="flex flex-col gap-spacing-12"
              onSubmit={(event) => {
                event.preventDefault()
                void submit({ vote: pending, comment })
              }}
            >
              <PopoverTitle
                id={titleId}
                className="text-type-heading-xs text-text-primary"
              >
                {REASON_TITLE[pending]}
              </PopoverTitle>
              <Textarea
                id={textareaId}
                aria-labelledby={titleId}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              {failed && failedMessage}
              <Button type="submit" disabled={submitting}>
                送出
              </Button>
            </form>
          )}
        </PopoverContent>
      </Popover>
      <Popover open={reasonsOpen} onOpenChange={setReasonsOpen}>
        <PopoverContent
          anchor={anchorRef}
          align="start"
          aria-label="大家留下的理由"
          className="w-[420px] max-w-[90vw]"
        >
          <Tabs
            value={reasonsTab}
            onValueChange={(value) => setReasonsTab(value)}
          >
            <TabsList>
              <TabsTab value="UPVOTE">
                {VOTE_LABEL.UPVOTE} {groupProps.positiveCount}
              </TabsTab>
              <TabsTab value="DOWNVOTE">
                {VOTE_LABEL.DOWNVOTE} {groupProps.negativeCount}
              </TabsTab>
            </TabsList>
            {(['UPVOTE', 'DOWNVOTE'] as const).map((vote) => (
              <TabsPanel key={vote} value={vote}>
                <ReasonList
                  vote={vote}
                  reasons={reasons}
                  expanded={expanded[vote]}
                  onExpand={() =>
                    setExpanded((current) => ({ ...current, [vote]: true }))
                  }
                  onRetry={onLoadReasons}
                />
              </TabsPanel>
            ))}
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  )
}
