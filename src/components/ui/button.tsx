import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Button: Size × Style × Icon × State. State (Hover / Active / Disabled) is drawn
 * for each Style at Size = Medium and applies to every size: hover and active are the
 * `*-hover` / `*-pressed` tokens, disabled is the default look at 50% opacity (R5).
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-radius-5 select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-surface-accent text-text-on-accent hover:bg-surface-accent-hover active:bg-surface-accent-pressed',
        outline:
          'border border-border-control text-text-primary hover:bg-surface-raised active:border-border-strong active:bg-surface-selected',
        secondary:
          'bg-surface-secondary text-text-on-secondary hover:bg-surface-secondary-hover active:bg-surface-secondary-pressed',
        // LINE green has no hover / pressed tokens (brand color), so it lightens and darkens.
        line: 'bg-surface-line text-text-on-line hover:brightness-110 active:brightness-90',
        'on-dark':
          'border border-border-on-dark bg-surface-dark text-text-on-dark hover:bg-surface-dark-raised',
      },
      size: {
        lg: 'min-h-[44px] gap-spacing-4 px-spacing-20 py-spacing-12 text-type-ui-l',
        md: 'min-h-[36px] gap-spacing-4 px-spacing-16 py-spacing-8 text-type-ui-m',
        sm: 'min-h-[28px] gap-spacing-4 px-spacing-8 py-spacing-4 text-type-ui-xs',
        'icon-touch': 'size-spacing-32 p-spacing-4',
      },
      /** Buttons with an icon use tighter horizontal padding (Penpot Icon = Front/Back/Both). */
      withIcon: { true: '', false: '' },
      iconOnly: { true: '', false: '' },
    },
    compoundVariants: [
      { size: 'md', withIcon: true, className: 'px-spacing-12' },
      { size: 'md', iconOnly: true, className: 'size-[36px] p-spacing-8' },
      { size: 'sm', iconOnly: true, className: 'size-[28px] p-spacing-4' },
      { size: 'lg', iconOnly: true, className: 'size-[44px] p-[10px]' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      withIcon: false,
      iconOnly: false,
    },
  },
)

type ButtonBaseProps = Omit<ButtonPrimitive.Props, 'children'> &
  Pick<VariantProps<typeof buttonVariants>, 'variant' | 'size'> & {
    iconStart?: MaterialSymbol
    iconEnd?: MaterialSymbol
  }

/** A button with text, or an icon-only button that must have an accessible name. */
export type ButtonProps = ButtonBaseProps &
  (
    | { children: React.ReactNode }
    | { children?: never; iconStart: MaterialSymbol; 'aria-label': string }
  )

function Button({
  className,
  variant,
  size,
  iconStart,
  iconEnd,
  children,
  ...props
}: ButtonProps) {
  const iconOnly = children === undefined || children === null
  // The 44px icon-only button gets a 24px icon; every other button keeps Penpot's 20px.
  const iconSize = size === 'lg' && iconOnly ? 24 : undefined
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({
          variant,
          size,
          withIcon: Boolean(iconStart || iconEnd),
          iconOnly,
        }),
        className,
      )}
      {...props}
    >
      {iconStart && <MaterialIcon name={iconStart} size={iconSize} />}
      {children}
      {iconEnd && <MaterialIcon name={iconEnd} />}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
