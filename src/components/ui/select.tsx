import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'

import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('flex flex-col gap-spacing-4', className)}
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
        'flex w-fit items-center justify-between gap-spacing-4 rounded-radius-5 border border-border-control bg-surface-base text-type-ui-m whitespace-nowrap text-text-primary data-placeholder:text-text-tertiary data-[size=default]:min-h-[36px] data-[size=default]:px-spacing-16 data-[size=default]:py-spacing-8 data-[size=sm]:min-h-[28px] data-[size=sm]:px-spacing-12 data-[size=sm]:py-spacing-4 *:data-[slot=select-value]:line-clamp-1 aria-invalid:border-status-incorrect disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <MaterialIcon
            name="keyboard_arrow_down"
            className="text-icon-default"
          />
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
            'border border-border-control bg-surface-base py-spacing-12 px-spacing-4 text-text-primary data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 min-w-[144px] rounded-radius-5 shadow-btn-shadow duration-100 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto data-[align-trigger=true]:animate-none',
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="flex flex-col gap-spacing-4">
            {children}
          </SelectPrimitive.List>
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
      className={cn(
        'px-spacing-12 text-type-ui-m text-text-tertiary',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Focus is the highlighted item's yellow background instead of the global ring: the popup scrolls,
 * so it would clip a ring that extends 8px past the item. The selected item is marked by the check.
 */
function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default scroll-my-spacing-4 items-center gap-spacing-8 rounded-radius-5 py-spacing-4 pr-[36px] pl-spacing-12 text-type-ui-m text-text-primary outline-hidden select-none focus-visible:[box-shadow:none] data-highlighted:bg-surface-accent-subtle data-highlighted:text-text-on-accent data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 gap-spacing-8 shrink-0 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-spacing-12 flex size-spacing-20 items-center justify-center" />
        }
      >
        <MaterialIcon name="check" />
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
        'bg-surface-selected -mx-spacing-4 my-spacing-4 h-px pointer-events-none',
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
        "bg-surface-base z-10 flex cursor-default items-center justify-center py-spacing-4 [&_svg:not([class*='size-'])]:size-spacing-16 top-0 w-full",
        className,
      )}
      {...props}
    >
      <MaterialIcon name="keyboard_arrow_up" />
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
        "bg-surface-base z-10 flex cursor-default items-center justify-center py-spacing-4 [&_svg:not([class*='size-'])]:size-spacing-16 bottom-0 w-full",
        className,
      )}
      {...props}
    >
      <MaterialIcon name="keyboard_arrow_down" />
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
