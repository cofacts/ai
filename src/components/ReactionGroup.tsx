import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { useState } from 'react'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

export type Reaction = 'up' | 'down' | null

/**
 * Penpot Feedback/ReactionGroup: 讚 and 倒讚 with their counts, joined to a trailing action
 * (Type = reason: 看理由, Type = report: a flag icon, solid while pressed).
 *
 * 讚 and 倒讚 are toggles (`<button aria-pressed>`), and at most one is pressed: pressing one
 * releases the other, pressing it again releases it. Like the 收藏 Toggle, an unpressed icon is
 * the outline, a pressed one is solid in the brand color (State = Up / Down).
 *
 * The three segments share their borders: each one has the full border and overlaps the previous
 * one by 1px, so the line between them stays 1px. Later segments paint over earlier ones, so the
 * focused segment is raised (`focus-visible:z-10`) to keep its focus ring whole.
 */
export function ReactionGroup({
  helpfulCount,
  unhelpfulCount,
  value,
  defaultValue = null,
  onValueChange,
  action,
  onAction,
  className,
}: {
  helpfulCount: number
  unhelpfulCount: number
  /** Controlled: which one is pressed. */
  value?: Reaction
  /** Uncontrolled: which one starts pressed. */
  defaultValue?: Reaction
  onValueChange?: (value: Reaction) => void
  /** reason = 看理由 (Penpot Type = reason); report = flag button (Type = report). */
  action: 'reason' | 'report'
  onAction?: () => void
  className?: string
}) {
  const [uncontrolled, setUncontrolled] = useState<Reaction>(defaultValue)
  const current = value === undefined ? uncontrolled : value

  const choose = (reaction: 'up' | 'down', pressed: boolean) => {
    const next = pressed ? reaction : null
    if (value === undefined) setUncontrolled(next)
    onValueChange?.(next)
  }

  return (
    <div
      role="group"
      aria-label="這則回應有幫助嗎"
      data-slot="reaction-group"
      className={cn('inline-flex', className)}
    >
      <ReactionToggle
        icon="thumb_up"
        label="讚"
        count={helpfulCount}
        pressed={current === 'up'}
        onPressedChange={(pressed) => choose('up', pressed)}
        className="rounded-l-radius-5"
      />
      <ReactionToggle
        icon="thumb_down"
        label="倒讚"
        count={unhelpfulCount}
        pressed={current === 'down'}
        onPressedChange={(pressed) => choose('down', pressed)}
        className="-ml-px"
      />
      <button
        type="button"
        onClick={onAction}
        aria-label={action === 'report' ? '檢舉這則回應' : undefined}
        className={cn(
          segment,
          'group/action -ml-px rounded-r-radius-5 px-spacing-12',
        )}
      >
        {action === 'report' ? (
          // While pressed, the flag turns solid.
          <>
            <MaterialIcon
              name="flag_2"
              className="group-active/action:hidden"
            />
            <MaterialIcon
              name="flag_2"
              filled
              className="hidden group-active/action:inline-flex"
            />
          </>
        ) : (
          '看理由'
        )}
      </button>
    </div>
  )
}

/** One segment: 36px high, control border, base background; hover raises it. */
const segment =
  'relative focus-visible:z-10 inline-flex h-[36px] shrink-0 items-center border border-border-control bg-surface-base text-type-ui-m whitespace-nowrap text-text-primary hover:bg-surface-raised'

function ReactionToggle({
  icon,
  label,
  count,
  pressed,
  onPressedChange,
  className,
}: {
  icon: MaterialSymbol
  label: string
  count: number
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  className?: string
}) {
  return (
    <TogglePrimitive
      pressed={pressed}
      onPressedChange={onPressedChange}
      aria-label={`${label} ${count}`}
      className={cn(
        segment,
        'group/reaction gap-spacing-4 pr-spacing-12 pl-spacing-8',
        className,
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
      {count}
    </TogglePrimitive>
  )
}
