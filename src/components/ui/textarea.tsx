import * as React from 'react'

import { inputBoxClassName } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Penpot Base/Input, Type = Textarea. Wrapping text, so it uses body-s, not a ui token. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        inputBoxClassName,
        'field-sizing-content min-h-106 resize-y p-12 text-body-s',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
