import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import type { ClassValue } from 'clsx'

import { twMergeTheme } from '@/styles/tokens.generated'

// tailwind-merge doesn't read our @theme. Without these names it treats `text-body-m` as a
// text color and drops it when merged with `text-text-primary`.
const twMerge = extendTailwindMerge({ extend: { theme: twMergeTheme } })

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}
