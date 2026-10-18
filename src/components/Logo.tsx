import logoIconOnDarkUrl from './logo/logo-icon-on-dark.svg'
import logoIconUrl from './logo/logo-icon.svg'
import logoOnDarkUrl from './logo/logo-on-dark.svg'
import logoUrl from './logo/logo.svg'
import { cn } from '@/lib/utils'

/*
 * The SVGs are rumors-site's components/AppLayout/images/logo-mobile.svg (110×31): logo.svg as
 * is, logo-on-dark.svg with the ink (#333333) switched to neutral-100, and the -icon files
 * cropped to the mark (viewBox 0 0 40 31). They are plain <img>s: drawing the paths inline
 * leaves hairline seams where shapes meet at non-integer sizes.
 */
const SRC = {
  symbol: { light: logoUrl, dark: logoOnDarkUrl, ratio: 110 / 31 },
  icon: { light: logoIconUrl, dark: logoIconOnDarkUrl, ratio: 40 / 31 },
}

/**
 * Penpot Layout/Logo. `symbol` = mark + 真的假的 / Cofacts, `icon` = the mark only. Decorative:
 * the link around it carries the name. The ink follows the theme (theme-light-only /
 * theme-dark-only in global.css); `onDark` always uses the light ink, for fixed-dark surfaces.
 */
export function Logo({
  variant = 'symbol',
  onDark = false,
  className,
}: {
  variant?: 'symbol' | 'icon'
  onDark?: boolean
  className?: string
}) {
  const { light, dark, ratio } = SRC[variant]
  const img = (src: string, extra?: string) => (
    <img
      src={src}
      alt=""
      height={28}
      width={Math.round(28 * ratio)}
      className={cn('h-28 w-auto shrink-0', extra, className)}
    />
  )
  if (onDark) return img(dark)
  return (
    <>
      {img(light, 'theme-light-only')}
      {img(dark, 'theme-dark-only')}
    </>
  )
}
