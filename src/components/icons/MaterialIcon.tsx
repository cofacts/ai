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

/** Glyphs that Penpot draws larger than the font does, scaled up inside the same box. */
const GLYPH_SCALE: Partial<Record<MaterialSymbol, number>> = {
  arrow_drop_down: 1.6,
}

/**
 * Not Google's `.material-symbols-rounded` class: that stylesheet is outside Tailwind's layers,
 * so it would override utilities such as `hidden` on the icon.
 */
const glyphStyle: CSSProperties = {
  fontFamily: "'Material Symbols Rounded'",
  fontWeight: 'normal',
  fontStyle: 'normal',
  lineHeight: 1,
  letterSpacing: 'normal',
  textTransform: 'none',
  whiteSpace: 'nowrap',
  direction: 'ltr',
  fontFeatureSettings: "'liga'",
}

/**
 * A Material Symbol (Rounded, with the designer's settings; see `material-symbols.ts`) by its
 * name. Decorative (`aria-hidden`): put the meaning on the surrounding button or text. Colors come
 * from `currentColor`, so use `text-icon-*` on the icon or a parent.
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
      translate="no"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-visible select-none',
        className,
      )}
      style={{
        ...glyphStyle,
        width: size,
        height: size,
        fontSize: size * (GLYPH_SCALE[name] ?? 1),
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}`,
        ...style,
      }}
      {...props}
    >
      {name}
    </span>
  )
}
