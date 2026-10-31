import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Badge, Type = normal / normal-active / icon-*: a pill that toggles a filter.
 * It renders `<button aria-pressed>`; pressed = normal-active.
 */
function Chip({
  className,
  icon,
  children,
  ...props
}: TogglePrimitive.Props & { icon?: MaterialSymbol }) {
  return (
    <TogglePrimitive
      data-slot="chip"
      className={cn(
        'inline-flex shrink-0 items-center gap-spacing-8 rounded-full border border-border-control px-spacing-16 py-spacing-8 text-type-ui-m whitespace-nowrap text-text-primary',
        'hover:bg-surface-raised data-pressed:border-transparent data-pressed:bg-surface-selected',
        'disabled:pointer-events-none disabled:border-transparent disabled:bg-surface-selected disabled:text-text-secondary disabled:opacity-50',
        icon && 'gap-spacing-4',
        className,
      )}
      {...props}
    >
      {icon && <MaterialIcon name={icon} size={22} />}
      {children}
    </TogglePrimitive>
  )
}

export { Chip }
