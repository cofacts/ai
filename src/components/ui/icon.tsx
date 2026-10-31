import { brandIconPaths } from './brand-icon-paths'
import { MATERIAL_SYMBOLS } from './material-symbols'
import type { BrandIconName } from './brand-icon-paths'
import type { MaterialSymbol } from './material-symbols'
import type { CSSProperties, HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type IconName = MaterialSymbol | BrandIconName

type IconProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  name: IconName
  /** The solid version (Material Symbols fill 1), e.g. a pressed bookmark. */
  filled?: boolean
  /** Box size in px. Penpot icons are 20px. */
  size?: number
}

/** Glyphs that Penpot draws larger than the font does, scaled up inside the same box. */
const GLYPH_SCALE: Partial<Record<IconName, number>> = { arrow_drop_down: 1.6 }

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

const isBrand = (name: IconName): name is BrandIconName =>
  name in brandIconPaths

/**
 * Penpot Base/Icon: a Material Symbol (Rounded, see `material-symbols.ts`) by its name, or a
 * brand mark. Decorative by default (`aria-hidden`): put the meaning on the surrounding button or
 * text. Colors come from `currentColor`, so use `text-icon-*` on the icon or a parent.
 */
export function Icon({
  name,
  filled = false,
  size = 20,
  className,
  style,
  ...props
}: IconProps) {
  if (isBrand(name)) {
    const [w, h, d] = brandIconPaths[name]
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        className={cn('shrink-0', className)}
        style={style}
        {...(props as React.SVGProps<SVGSVGElement>)}
      >
        <path d={d} />
      </svg>
    )
  }
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

export const iconNames: Array<IconName> = [
  ...MATERIAL_SYMBOLS,
  ...(Object.keys(brandIconPaths) as Array<BrandIconName>),
]
