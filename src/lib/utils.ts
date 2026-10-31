import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import type { ClassValue } from 'clsx'

import { twMergeTheme } from '@/styles/tokens.generated'

// tailwind-merge doesn't read our @theme. Without these names it treats `text-type-body-m` as a
// text color and drops it when merged with `text-text-primary`, and leaves spacing, radius and
// shadow tokens unmerged. Colors need no list: any unrecognized value after text-, bg- or
// border- is already a color to tailwind-merge.
const twMerge = extendTailwindMerge({ extend: { theme: twMergeTheme } })

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}
