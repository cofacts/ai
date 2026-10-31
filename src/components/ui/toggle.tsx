import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Toggle (e.g. 收藏). `<button aria-pressed>`; pressed shows a strong border and the
 * icon's solid version (bookmark → filled bookmark).
 */
function Toggle({
  className,
  icon,
  children,
  ...props
}: TogglePrimitive.Props & { icon?: MaterialSymbol }) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(
        'group/toggle inline-flex min-h-spacing-32 shrink-0 items-center gap-spacing-4 rounded-radius-5 border border-border-control px-spacing-12 py-spacing-8 text-type-ui-m whitespace-nowrap text-text-primary',
        'hover:bg-surface-base data-pressed:border-border-strong data-pressed:bg-surface-base',
        'disabled:pointer-events-none disabled:opacity-50',
        icon && 'min-h-[36px] pl-spacing-8',
        className,
      )}
      {...props}
    >
      {icon && (
        <>
          <MaterialIcon
            name={icon}
            className="group-data-pressed/toggle:hidden"
          />
          <MaterialIcon
            name={icon}
            filled
            className="hidden group-data-pressed/toggle:inline-flex"
          />
        </>
      )}
      {children}
    </TogglePrimitive>
  )
}

export { Toggle }
