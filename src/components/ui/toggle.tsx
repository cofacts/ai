import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import type { IconName } from '@/components/ui/icon'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Toggle (e.g. 收藏). `<button aria-pressed>`; pressed shows a strong border, and
 * `pressedIcon` (e.g. bookmark-fill) if given.
 */
function Toggle({
  className,
  icon,
  pressedIcon,
  children,
  ...props
}: TogglePrimitive.Props & { icon?: IconName; pressedIcon?: IconName }) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(
        'group/toggle inline-flex min-h-32 shrink-0 items-center gap-4 rounded-5 border border-control px-12 py-8 text-ui-m whitespace-nowrap text-primary',
        'hover:bg-base data-pressed:border-strong data-pressed:bg-base',
        'disabled:pointer-events-none disabled:opacity-50',
        icon && 'min-h-36 pl-8',
        className,
      )}
      {...props}
    >
      {icon && (
        <>
          <Icon
            name={icon}
            className={cn(pressedIcon && 'group-data-pressed/toggle:hidden')}
          />
          {pressedIcon && (
            <Icon
              name={pressedIcon}
              className="hidden group-data-pressed/toggle:block"
            />
          )}
        </>
      )}
      {children}
    </TogglePrimitive>
  )
}

export { Toggle }
