import { Button as ButtonPrimitive } from '@base-ui/react/button'

import type { IconName } from '@/components/ui/icon'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Button AI: a pill with a brand-yellow gradient border, used to start AI actions
 * (查核回覆草稿, 搜尋資料庫). Penpot can't bind gradients to tokens, so the border is rebuilt
 * here from brand tokens (a11y guide 07). Hover fills it yellow. `loading` sets aria-busy.
 */
export function AiButton({
  icon,
  loading = false,
  variant = 'default',
  className,
  children,
  ...props
}: ButtonPrimitive.Props & {
  icon?: IconName
  loading?: boolean
  /** secondary = grey pill without the gradient border (Penpot State = Secondary). */
  variant?: 'default' | 'secondary'
}) {
  return (
    <ButtonPrimitive
      data-slot="ai-button"
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-h-[36px] shrink-0 items-center gap-spacing-8 rounded-full px-spacing-16 py-spacing-8 text-type-ui-m whitespace-nowrap text-text-primary',
        variant === 'default' &&
          'border-2 border-transparent [background:linear-gradient(var(--color-surface-base),var(--color-surface-base))_padding-box,linear-gradient(90deg,var(--brand-500-main),var(--brand-300))_border-box] hover:text-text-on-accent hover:[background:linear-gradient(var(--color-surface-accent),var(--color-surface-accent))_padding-box,linear-gradient(90deg,var(--brand-500-main),var(--brand-300))_border-box]',
        variant === 'secondary' &&
          'gap-spacing-4 bg-surface-raised hover:bg-surface-selected',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {icon && (
        <Icon
          name={icon}
          className={cn(loading && 'motion-safe:animate-spin')}
        />
      )}
      {children}
    </ButtonPrimitive>
  )
}
