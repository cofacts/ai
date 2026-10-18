import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import type { IconName } from '@/components/ui/icon'
import { Icon } from '@/components/ui/icon'
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
}: useRender.ComponentProps<'span'> & { icon?: IconName }) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(
          'inline-flex w-fit shrink-0 items-center gap-4 rounded-full border border-control py-8 pr-12 pl-16 text-ui-m whitespace-nowrap text-primary',
          !icon && 'pr-16',
          className,
        ),
        children: (
          <>
            {children}
            {icon && <Icon name={icon} />}
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
