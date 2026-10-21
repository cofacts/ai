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
      className={cn('flex flex-col gap-12', className)}
      {...props}
    />
  )
}

/** A 20px circle; selected = thick (3px) strong border. */
function RadioGroupItem({ className, ...props }: Radio.Root.Props) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      // A native <button> is labelable, so a wrapping <label> names it.
      nativeButton
      render={<button type="button" />}
      className={cn(
        'relative flex size-20 shrink-0 rounded-full border border-control bg-base',
        'after:absolute after:-inset-6 data-checked:border-3 data-checked:border-strong',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { RadioGroup, RadioGroupItem }
