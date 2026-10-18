import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import type { IconName } from '@/components/ui/icon'
import { Icon } from '@/components/ui/icon'
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
}: TogglePrimitive.Props & { icon?: IconName }) {
  return (
    <TogglePrimitive
      data-slot="chip"
      className={cn(
        'inline-flex shrink-0 items-center gap-8 rounded-full border border-control px-16 py-8 text-ui-m whitespace-nowrap text-primary',
        'hover:bg-raised data-pressed:border-transparent data-pressed:bg-selected',
        'disabled:pointer-events-none disabled:border-transparent disabled:bg-selected disabled:text-secondary disabled:opacity-50',
        icon && 'gap-4',
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={22} />}
      {children}
    </TogglePrimitive>
  )
}

export { Chip }
