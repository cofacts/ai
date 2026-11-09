import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
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
 * Every segment: 36px high (a min-height, so larger text grows it), control border, base
 * background; hover raises it. Full width with equal segments on mobile (ReplyCard-Mobile), its
 * own width from `md` up.
 *
 * The segments share their borders: each one has the full border and overlaps the previous one
 * by 1px, so the line between them stays 1px. Later segments paint over earlier ones, so the
 * focused segment is raised (`focus-visible:z-10`) to keep its focus ring whole.
 */
const segment =
  'relative inline-flex min-h-[36px] flex-1 shrink cursor-pointer items-center justify-center border border-border-control bg-surface-base py-0 text-type-ui-m whitespace-nowrap text-text-primary not-first:-ml-px first:rounded-l-radius-5 last:rounded-r-radius-5 hover:bg-surface-raised focus-visible:z-10 disabled:pointer-events-none disabled:opacity-50 md:flex-none md:shrink-0'

/**
 * Penpot Feedback/ReactionGroup: 有幫助 / 沒幫助 with their counts, then
 * 看理由 or 檢舉. Presentational only: the reasons list, the reason form after a vote and the
 * report dialog belong to `ReplyFeedback`, which wraps this and handles the callbacks.
 *
 * 有幫助 and 沒幫助 are toggles (`<button aria-pressed>`), and at most one is pressed. Like the
 * 收藏 Toggle, an unpressed icon is the outline and a pressed one is solid in the brand color
 * (State = Up / Down). The last segment is a plain button: it has no pressed state.
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
      data-slot="reaction-group"
      className={cn('flex w-full md:inline-flex md:w-auto', className)}
    >
      <VoteToggle
        icon="thumb_up"
        label="有幫助"
        count={positiveCount}
        pressed={ownVote === 'UPVOTE'}
        onPressedChange={vote('UPVOTE')}
        disabled={voteDisabled}
      />
      <VoteToggle
        icon="thumb_down"
        label="沒幫助"
        count={negativeCount}
        pressed={ownVote === 'DOWNVOTE'}
        onPressedChange={vote('DOWNVOTE')}
        disabled={voteDisabled}
      />
      {type === 'reason' ? (
        <button
          type="button"
          className={cn(segment, 'px-spacing-12')}
          onClick={onShowReasons}
        >
          看理由
        </button>
      ) : (
        <button
          type="button"
          aria-label="檢舉"
          className={cn(segment, 'group/action px-spacing-12')}
          onClick={onReport}
        >
          {/* While pressed, the flag turns solid. */}
          <MaterialIcon name="flag_2" className="group-active/action:hidden" />
          <MaterialIcon
            name="flag_2"
            filled
            className="hidden group-active/action:inline-flex"
          />
        </button>
      )}
    </div>
  )
}

function VoteToggle({
  icon,
  label,
  count,
  pressed,
  onPressedChange,
  disabled,
}: {
  icon: MaterialSymbol
  label: string
  count: number
  pressed: boolean
  onPressedChange: () => void
  disabled?: boolean
}) {
  return (
    <TogglePrimitive
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      className={cn(
        segment,
        'group/reaction gap-spacing-4 pr-spacing-12 pl-spacing-8',
      )}
    >
      <MaterialIcon
        name={icon}
        className="group-data-pressed/reaction:hidden"
      />
      <MaterialIcon
        name={icon}
        filled
        className="hidden text-icon-brand group-data-pressed/reaction:inline-flex"
      />
      <span className="sr-only">{label}</span>
      {count}
    </TogglePrimitive>
  )
}
