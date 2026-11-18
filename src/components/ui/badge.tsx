import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Penpot Base/Badge: a pill-shaped toggle for a filter, `<button aria-pressed>`. It is a Toggle
 * with a different look: Base/Toggle is the square one.
 *
 * Unpressed it is a grey pill with no border; hover darkens the grey. Pressed (selected) it
 * keeps the grey and adds a strong border. Disabled is the unpressed look at 50% opacity
 * (R5). The border is always there (transparent when unpressed), so pressing doesn't shift it.
 *
 * Penpot's Type values:
 * - `normal` / `normal-active` / `disable`: unpressed, pressed (`pressed` / `defaultPressed`) and
 *   `disabled`.
 * - `icon-*`: the same with an `icon` before the text, e.g. a `StatusIcon`.
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
        'inline-flex shrink-0 items-center gap-spacing-8 rounded-full border border-transparent bg-surface-raised px-spacing-16 py-spacing-8 text-type-ui-m whitespace-nowrap text-text-primary',
        'hover:bg-surface-selected data-pressed:border-border-strong',
        'disabled:pointer-events-none disabled:opacity-50',
        icon !== undefined && 'gap-spacing-4',
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
