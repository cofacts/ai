import styles from './MaterialIcon.module.css'
import type { MaterialSymbol } from './material-symbols'
import type { CSSProperties, HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type MaterialIconProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** A name listed in `material-symbols.ts`; the font only has those glyphs. */
  name: MaterialSymbol
  /** The solid version (fill 1), e.g. a pressed bookmark. */
  filled?: boolean
  /** Box size in px. Penpot icons are 20px. */
  size?: number
}

/**
 * A Material Symbol (Rounded, with the designer's settings; see `material-symbols.ts`) by its
 * name. Decorative (`aria-hidden`): put the meaning on the surrounding button or text. Colors come
 * from `currentColor`, so use `text-icon-*` on the icon or a parent. The styles are one class in
 * `MaterialIcon.module.css`; the size is passed as `--icon-size`.
 */
export function MaterialIcon({
  name,
  filled = false,
  size = 20,
  className,
  style,
  ...props
}: MaterialIconProps) {
  return (
    <span
      aria-hidden="true"
      data-icon={name}
      data-filled={filled || undefined}
      className={cn(styles.icon, className)}
      style={{ '--icon-size': `${size}px`, ...style } as CSSProperties}
      {...props}
    />
  )
}
