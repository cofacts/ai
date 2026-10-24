import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('scroll-my-4 p-4', className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn('flex flex-1 text-left', className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'flex w-fit items-center justify-between gap-4 rounded-5 border border-control bg-base text-ui-m whitespace-nowrap text-primary data-placeholder:text-tertiary data-[size=default]:min-h-36 data-[size=default]:px-16 data-[size=default]:py-8 data-[size=sm]:min-h-28 data-[size=sm]:px-12 data-[size=sm]:py-4 *:data-[slot=select-value]:line-clamp-1 aria-invalid:border-status-incorrect disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <Icon name="keyboard-arrow-down" className="text-icon-default" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'alignItemWithTrigger'
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            'border border-control bg-base py-12 px-4 text-primary data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 min-w-144 rounded-5 shadow-btn duration-100 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto data-[align-trigger=true]:animate-none',
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('px-12 pt-4 pb-8 text-ui-m text-tertiary', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-8 rounded-2 py-4 pr-36 pl-12 text-ui-m text-primary outline-hidden select-none data-highlighted:bg-raised data-selected:bg-accent-subtle data-selected:text-on-accent data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 gap-8 shrink-0 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-12 flex size-20 items-center justify-center" />
        }
      >
        <Icon name="check" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        'bg-selected -mx-4 my-4 h-px pointer-events-none',
        className,
      )}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "bg-base z-10 flex cursor-default items-center justify-center py-4 [&_svg:not([class*='size-'])]:size-16 top-0 w-full",
        className,
      )}
      {...props}
    >
      <Icon name="keyboard-arrow-up" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bg-base z-10 flex cursor-default items-center justify-center py-4 [&_svg:not([class*='size-'])]:size-16 bottom-0 w-full",
        className,
      )}
      {...props}
    >
      <Icon name="keyboard-arrow-down" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
