import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/utils'

/**
 * The input box look shared by Input and Textarea (Penpot Base/Input). White background; while
 * typing, a brand-yellow border (border-accent) — the global focus ring still shows, because
 * yellow alone is too weak. Invalid: red border + aria-invalid; pair it with a FieldError.
 */
export const inputBoxClassName =
  'w-full min-w-0 rounded-5 border-[0.5px] border-control bg-base text-primary placeholder:text-tertiary hover:border-strong focus:border-accent focus:border focus:hover:border-accent aria-invalid:border aria-invalid:border-status-incorrect disabled:pointer-events-none disabled:opacity-50'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        inputBoxClassName,
        'min-h-38 px-12 py-12 text-ui-s',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
