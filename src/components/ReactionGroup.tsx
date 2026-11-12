import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

/** rumors-api `FeedbackVote`. NEUTRAL takes a vote back. */
export type ReplyVote = 'UPVOTE' | 'DOWNVOTE' | 'NEUTRAL'

export type ReactionGroupProps = {
  /**
   * Penpot Type. `reason` ends with 看理由 (the reasons other users gave); `report` ends with a
   * flag button for 檢舉.
   */
  type?: 'reason' | 'report'
  /** 有幫助 votes. */
  positiveCount: number
  /** 沒幫助 votes. */
  negativeCount: number
  /** The current user's vote; null or undefined when they haven't voted. */
  ownVote?: 'UPVOTE' | 'DOWNVOTE' | null
  /**
   * Pressing a vote sends it; pressing the vote you already gave sends NEUTRAL. The parent owns
   * the vote state: the buttons show `ownVote`, not what was pressed.
   */
  onVote?: (vote: ReplyVote) => void
  /** 看理由 (`type="reason"`). */
  onShowReasons?: () => void
  /** The flag button (`type="report"`). */
  onReport?: () => void
  /** Disables both vote buttons (R5), e.g. while a vote is being saved. */
  voteDisabled?: boolean
  className?: string
}

/**
 * Every segment of Penpot's group: Base/Toggle sizes and square inner corners. Each keeps its own
 * 1px border, so two meet as 2px like in Penpot.
 *
 * No fill: Penpot's instances fill with surface-base, the color of the card under them, so it
 * looks the same. A fill would also paint over the focus ring of the segment before it.
 */
const segment =
  'flex-1 shrink rounded-none md:flex-none md:shrink-0 first:rounded-l-radius-5 last:rounded-r-radius-5'

/**
 * A vote Toggle. Penpot's Thumb Up / Thumb Down icons are the solid glyphs in every state
 * (mapping-rules), so the icon goes in as a child: Toggle's `icon` prop would show the outline
 * glyph until pressed. The classes are the ones Toggle adds with `icon`.
 */
const voteSegment = cn(segment, 'min-h-[36px] pl-spacing-8')

/**
 * The last segment (看理由 or the flag) is a plain button, not a Toggle. Penpot draws it as a
 * plain frame in the group with Base/Button (Medium, Outline) sizes: 36px tall, 12px sides, 8px
 * gap. It has no pressed state, so it can't be a Toggle (`aria-pressed`). Penpot defines no hover
 * for it; it gets Toggle's hover so the row reacts alike.
 */
const lastSegment = cn(
  'inline-flex min-h-[36px] cursor-pointer items-center justify-center gap-spacing-8 border border-border-control px-spacing-12 py-0 text-type-ui-m whitespace-nowrap text-text-primary hover:bg-surface-base',
  segment,
)

/**
 * [Penpot Feedback/ReactionGroup](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=f402ced6-616c-80b4-8008-6d275a72b495): 有幫助 / 沒幫助 counts as Base/Toggle (`aria-pressed`), then
 * 看理由 or 檢舉. Presentational only: the reasons list, the reason form after a vote and the
 * report dialog belong to `ReplyFeedback`, which wraps this and handles the callbacks.
 *
 * Full width with equal segments on mobile (ReplyCard-Mobile), its own width from `md` up.
 */
export function ReactionGroup({
  type = 'reason',
  positiveCount,
  negativeCount,
  ownVote,
  onVote,
  onShowReasons,
  onReport,
  voteDisabled,
  className,
}: ReactionGroupProps) {
  const vote = (value: 'UPVOTE' | 'DOWNVOTE') => () =>
    onVote?.(ownVote === value ? 'NEUTRAL' : value)

  return (
    <div
      role="group"
      aria-label="評價這則回應"
      className={cn('flex w-full md:w-auto', className)}
    >
      <Toggle
        pressed={ownVote === 'UPVOTE'}
        onPressedChange={vote('UPVOTE')}
        disabled={voteDisabled}
        className={voteSegment}
      >
        <MaterialIcon
          name="thumb_up"
          filled
          className="group-data-pressed/toggle:text-icon-brand"
        />
        <span className="sr-only">有幫助</span>
        {positiveCount}
      </Toggle>
      <Toggle
        pressed={ownVote === 'DOWNVOTE'}
        onPressedChange={vote('DOWNVOTE')}
        disabled={voteDisabled}
        className={voteSegment}
      >
        <MaterialIcon
          name="thumb_down"
          filled
          className="group-data-pressed/toggle:text-icon-brand"
        />
        <span className="sr-only">沒幫助</span>
        {negativeCount}
      </Toggle>
      {type === 'reason' ? (
        <button type="button" className={lastSegment} onClick={onShowReasons}>
          看理由
        </button>
      ) : (
        <button
          type="button"
          aria-label="檢舉"
          className={lastSegment}
          onClick={onReport}
        >
          <MaterialIcon name="flag_2" filled />
        </button>
      )}
    </div>
  )
}
