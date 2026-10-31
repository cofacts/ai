import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import type { ClassValue } from 'clsx'

import { twMergeColors, twMergeTheme } from '@/styles/tokens.generated'

// tailwind-merge doesn't read our @theme. Without these names it treats `text-type-body-m` as a
// text color and drops it when merged with `text-text-primary`. Colors are registered per prefix,
// so a surface name like `base` doesn't turn `text-base` into a text color.
const twMerge = extendTailwindMerge({
  extend: {
    theme: twMergeTheme,
    classGroups: {
      'text-color': [{ text: twMergeColors.text }],
      'bg-color': [{ bg: twMergeColors.bg }],
      'border-color': [{ border: twMergeColors.border }],
    },
  },
})

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}
