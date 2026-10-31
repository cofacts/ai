import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import type { IconName } from '@/components/ui/icon'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/** Penpot Base/Button: Size × Style × Icon. */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-radius-5 select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-surface-accent text-text-on-accent hover:bg-surface-accent-subtle',
        outline:
          'border border-border-control text-text-primary hover:bg-surface-raised',
        secondary:
          'bg-surface-secondary text-text-on-secondary hover:opacity-90',
        line: 'bg-surface-line text-text-on-line hover:opacity-90',
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
      { size: 'lg', iconOnly: true, className: 'size-[44px] p-spacing-12' },
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
    iconStart?: IconName
    iconEnd?: IconName
  }

/** A button with text, or an icon-only button that must have an accessible name. */
export type ButtonProps = ButtonBaseProps &
  (
    | { children: React.ReactNode }
    | { children?: never; iconStart: IconName; 'aria-label': string }
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
      {iconStart && <Icon name={iconStart} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
