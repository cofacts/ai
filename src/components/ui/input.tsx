import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/utils'

/**
 * While typing, a text field shows a 2px strong border instead of the global focus ring (the
 * designer's call: the ring read as an error-like state on every field). It is an outline drawn
 * inside the box, so nothing shifts; border-strong is 15+ on white, enough on its own (the old
 * brand-yellow border was 1.76 and needed the ring). Invalid fields keep a red one.
 */
export const textFieldFocusClassName =
  'focus-visible:[box-shadow:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-strong aria-invalid:focus-visible:outline-status-incorrect'

/**
 * The input box look shared by Input and Textarea (Penpot Base/Input). White background; while
 * typing, the strong border above. Invalid: red border + aria-invalid; pair it with a FieldError.
 */
export const inputBoxClassName =
  'w-full min-w-0 rounded-radius-5 border-[0.5px] border-border-control bg-surface-base text-text-primary placeholder:text-text-tertiary hover:border-border-strong aria-invalid:border aria-invalid:border-status-incorrect disabled:pointer-events-none disabled:opacity-50 ' +
  textFieldFocusClassName

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        inputBoxClassName,
        'min-h-[38px] px-spacing-12 py-spacing-12 text-type-ui-s',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
