import * as React from 'react'

import { inputBoxClassName } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Penpot Base/Input, Type = Textarea. Wrapping text, so it uses body-s, not a ui token. Body-s
 * adds ~5px of line height above the first line, so 8px top and bottom padding looks like the
 * 12px on the sides (and like the single-line Input).
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        inputBoxClassName,
        'field-sizing-content min-h-[106px] resize-y px-spacing-12 py-spacing-8 text-type-body-s',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
