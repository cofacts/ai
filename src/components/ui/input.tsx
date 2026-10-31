import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/utils'

/**
 * The input box look shared by Input and Textarea (Penpot Base/Input). White background; while
 * typing, a brand-yellow border (border-accent) — the global focus ring still shows, because
 * yellow alone is too weak. Invalid: red border + aria-invalid; pair it with a FieldError.
 */
export const inputBoxClassName =
  'w-full min-w-0 rounded-radius-5 border-[0.5px] border-border-control bg-surface-base text-text-primary placeholder:text-text-tertiary hover:border-border-strong focus:border-border-accent focus:border focus:hover:border-border-accent aria-invalid:border aria-invalid:border-status-incorrect disabled:pointer-events-none disabled:opacity-50'

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
