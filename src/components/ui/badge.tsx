import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Penpot Base/Badge: a pill-shaped toggle for a filter, `<button aria-pressed>`. It is a Toggle
 * with a different look: Base/Toggle is the square one.
 *
 * Penpot's Type values map to its state and props:
 * - `normal` / `normal-active` / `disable`: unpressed, pressed (`pressed` / `defaultPressed`) and
 *   `disabled`.
 * - `icon-default` / `icon-active`: the same with an `icon` before the text, e.g. a `StatusIcon`.
 *   Pressed, it has no background and its border turns transparent (it still takes up space).
 * - `fix` (a trailing wrench) marks a filter that is an internal feature; the designer's note says
 *   it will go away, so it has no prop here.
 *
 * For a row of badges, wrap them in shadcn's `ToggleGroup`.
 */
function Badge({
  className,
  icon,
  children,
  ...props
}: TogglePrimitive.Props & {
  /** Shown before the text (Type = icon-*). */
  icon?: ReactNode
}) {
  return (
    <TogglePrimitive
      data-slot="badge"
      className={cn(
        'inline-flex shrink-0 items-center gap-spacing-8 rounded-full border border-border-control px-spacing-16 py-spacing-8 text-type-ui-m whitespace-nowrap text-text-primary',
        'hover:bg-surface-raised data-pressed:border-transparent data-pressed:bg-surface-selected',
        'disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-selected disabled:text-text-secondary disabled:opacity-50',
        icon !== undefined && 'gap-spacing-4 data-pressed:bg-transparent',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </TogglePrimitive>
  )
}

export { Badge }
