import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Checkbox: a 16px box. Checked = inverse fill with a check. Wrap it with a
 * `<label>` (or Field) so the title is clickable; the hit area extends with `after:`.
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
        'after:absolute after:-inset-spacing-8 data-checked:border-border-inverse data-checked:bg-surface-inverse',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <Icon name="check" size={14} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
