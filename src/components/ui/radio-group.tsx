import { Radio } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'

import { cn } from '@/lib/utils'

/**
 * Penpot Base/RadioGroup. Base UI's RadioGroup handles arrow keys; put it inside a
 * `<fieldset>` + `<legend>` (FieldSet / FieldLegend) so the group has a name.
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('flex flex-col gap-spacing-12', className)}
      {...props}
    />
  )
}

/**
 * A 20px circle (Penpot State: Default / Hover / Selected / Disabled). Unselected is a thin
 * control border that turns strong on hover; selected is a solid circle with a dot in the
 * middle, like a native radio.
 */
function RadioGroupItem({ className, ...props }: Radio.Root.Props) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      // A native <button> is labelable, so a wrapping <label> names it.
      nativeButton
      render={<button type="button" />}
      className={cn(
        'relative flex size-spacing-20 shrink-0 rounded-full border border-border-control bg-surface-base',
        'after:absolute after:-inset-[6px] hover:border-border-strong data-checked:border-icon-default data-checked:bg-icon-default',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Radio.Indicator className="m-auto size-spacing-8 rounded-full bg-surface-base" />
    </Radio.Root>
  )
}

export { RadioGroup, RadioGroupItem }
