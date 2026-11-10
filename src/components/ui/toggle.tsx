import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/**
 * [Penpot Base/Toggle](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=d3600d97-74cb-80be-8008-50ec79e9e8f9)
 * (e.g. 收藏). `<button aria-pressed>`; hover shows the solid icon as a
 * preview; pressed shows a strong border and the solid icon in brand yellow (`icon-brand`).
 *
 * Penpot draws the 1px border inside the padding (inner stroke): 32px tall with text only, 36px
 * with an icon. A CSS border sits outside the padding, so the height is a min-height with no
 * vertical padding and the content centered: the default size matches Penpot, and larger text
 * (zoom, bigger default font) grows the button instead of being clipped.
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
        'group/toggle inline-flex min-h-spacing-32 shrink-0 cursor-pointer items-center gap-spacing-4 rounded-radius-5 border border-border-control px-spacing-12 py-0 text-type-ui-m whitespace-nowrap text-text-primary',
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
            className="group-hover/toggle:hidden group-data-pressed/toggle:hidden"
          />
          <MaterialIcon
            name={icon}
            filled
            className="hidden group-hover/toggle:inline-flex group-data-pressed/toggle:hidden"
          />
          <MaterialIcon
            name={icon}
            filled
            className="hidden text-icon-brand group-data-pressed/toggle:inline-flex"
          />
        </>
      )}
      {children}
    </TogglePrimitive>
  )
}

export { Toggle }
