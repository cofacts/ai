import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Badge, Type = fix: a static pill label such as「還未有效查核」.
 * For a selectable filter pill (Type = normal / normal-active) use `Chip`.
 */
function Badge({
  className,
  icon,
  children,
  render,
  ...props
}: useRender.ComponentProps<'span'> & { icon?: MaterialSymbol }) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(
          'inline-flex w-fit shrink-0 items-center gap-spacing-4 rounded-full border border-border-control py-spacing-8 pr-spacing-12 pl-spacing-16 text-type-ui-m whitespace-nowrap text-text-primary',
          !icon && 'pr-spacing-16',
          className,
        ),
        children: (
          <>
            {children}
            {icon && <MaterialIcon name={icon} />}
          </>
        ),
      },
      props,
    ),
    render,
    state: { slot: 'badge' },
  })
}

export { Badge }
