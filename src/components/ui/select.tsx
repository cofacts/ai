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
        'flex w-fit items-center justify-between gap-[6px] rounded-radius-5 border border-border-control bg-surface-base text-type-ui-m whitespace-nowrap text-text-primary data-placeholder:text-text-tertiary data-[size=default]:h-[36px] data-[size=default]:px-spacing-12 data-[size=sm]:h-[28px] data-[size=sm]:px-spacing-8 *:data-[slot=select-value]:line-clamp-1 aria-invalid:border-status-incorrect disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {/*
        Children replace Base UI's default ▼ glyph. The chevron is ~9px wide in its 20px box, so
        it has ~5.5px of blank space on each side. A 6px gap and -6px here make the visible space
        on both sides of the chevron ~12px, the same as the padding before the text (and the
        items' padding in the popup). 1px down centers it on CJK text, whose glyphs sit low.
      */}
      <SelectPrimitive.Icon className="-mr-[6px] flex translate-y-[1px] text-icon-default">
        <MaterialIcon name="keyboard_arrow_down" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/**
 * The popup opens below the trigger, left edges aligned. Its 1px border + 4px inset + the items'
 * 8px padding put the item text 13px from the edge, the same as the trigger's text (1px border +
 * 12px padding), so the text lines up. The group label has the items' padding too, so it is as
 * far from the first item as the items are from each other.
 */
function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  alignOffset = 0,
  alignItemWithTrigger = false,
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
            'border border-border-control bg-surface-base py-spacing-8 px-spacing-4 text-text-primary data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-[2px] data-[side=left]:slide-in-from-right-[2px] data-[side=right]:slide-in-from-left-[2px] data-[side=top]:slide-in-from-bottom-[2px] min-w-[144px] rounded-radius-5 shadow-btn-shadow duration-100 data-[side=inline-start]:slide-in-from-right-[2px] data-[side=inline-end]:slide-in-from-left-[2px] relative isolate z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto data-[align-trigger=true]:animate-none',
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
        'px-spacing-8 py-spacing-4 text-type-ui-m text-text-tertiary',
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
        'relative flex w-full cursor-default scroll-my-spacing-4 items-center gap-spacing-8 rounded-radius-5 py-spacing-4 pr-spacing-32 pl-spacing-8 text-type-ui-m text-text-primary outline-hidden select-none focus-visible:[box-shadow:none] data-highlighted:bg-surface-accent-subtle data-highlighted:text-text-on-accent data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 gap-spacing-8 shrink-0 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-spacing-8 flex size-spacing-20 items-center justify-center" />
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
