import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'

import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Checkbox: a 16px box. Like the radio, unchecked is a thin control border that
 * turns strong on hover; checked is a solid box (icon-default, the same as a selected radio)
 * with a check. The border takes the fill's color when checked, so the box doesn't look smaller.
 * Wrap it with a `<label>` (or Field) so the title is clickable; the hit area extends with
 * `after:`.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      // A native <button> is labelable, so a wrapping <label> names it.
      nativeButton
      render={<button type="button" />}
      className={cn(
        'relative flex size-spacing-16 shrink-0 items-center justify-center rounded-radius-2 border border-border-control bg-surface-base text-text-inverse',
        'after:absolute after:-inset-spacing-8 hover:border-border-strong data-checked:border-icon-default data-checked:bg-icon-default',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <MaterialIcon name="check" size={14} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
