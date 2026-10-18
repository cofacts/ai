import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import type { IconName } from '@/components/ui/icon'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/** Penpot Base/Button: Size × Style × Icon. */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-5 select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-subtle',
        outline: 'border border-control text-primary hover:bg-raised',
        secondary: 'bg-secondary text-on-secondary hover:opacity-90',
        line: 'bg-line text-on-line hover:opacity-90',
        'on-dark':
          'border border-on-dark bg-dark text-on-dark hover:bg-dark-raised',
      },
      size: {
        lg: 'min-h-44 gap-4 px-20 py-12 text-ui-l',
        md: 'min-h-36 gap-4 px-16 py-8 text-ui-m',
        sm: 'min-h-28 gap-4 px-8 py-4 text-ui-xs',
        'icon-touch': 'size-32 p-4',
      },
      /** Buttons with an icon use tighter horizontal padding (Penpot Icon = Front/Back/Both). */
      withIcon: { true: '', false: '' },
      iconOnly: { true: '', false: '' },
    },
    compoundVariants: [
      { size: 'md', withIcon: true, className: 'px-12' },
      { size: 'md', iconOnly: true, className: 'size-36 p-8' },
      { size: 'sm', iconOnly: true, className: 'size-28 p-4' },
      { size: 'lg', iconOnly: true, className: 'size-44 p-12' },
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
