import { LOGO_PATHS as PATHS } from '@/components/logo-paths'
import { cn } from '@/lib/utils'

/** The mark alone is the first 4 paths, within the left 40px of the 110×31 artboard. */
const MARK_PATHS = PATHS.slice(0, 4)

/**
 * Penpot Layout/Logo. `symbol` = mark + 真的假的 / Cofacts, `icon` = the mark only.
 * Logos are exempt from the yellow-text rule (R2). The link around it carries the name.
 */
export function Logo({
  variant = 'symbol',
  onDark = false,
  className,
}: {
  variant?: 'symbol' | 'icon'
  /** On a fixed-dark surface (bg-dark): the mark and wordmark use icon-on-dark (R4). */
  onDark?: boolean
  className?: string
}) {
  const paths = variant === 'symbol' ? PATHS : MARK_PATHS
  return (
    <svg
      viewBox={`0 0 ${variant === 'symbol' ? 110 : 40} 31`}
      aria-hidden="true"
      focusable="false"
      className={cn('h-[28px] w-auto shrink-0', className)}
    >
      {paths.map(([isBrand, d], i) => (
        <path
          key={i}
          d={d}
          className={cn(
            'fill-current',
            isBrand
              ? 'text-icon-brand'
              : onDark
                ? 'text-icon-on-dark'
                : 'text-icon-default',
          )}
        />
      ))}
    </svg>
  )
}
