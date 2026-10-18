import { iconPaths } from './icon-paths'
import type { IconName } from './icon-paths'
import type { SVGProps } from 'react'

import { cn } from '@/lib/utils'

export type { IconName }

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: IconName
  /** Rendered size in px. Penpot icons are 20px. */
  size?: number
}

/**
 * Penpot Base/Icon. Decorative by default (`aria-hidden`): put the meaning on the surrounding
 * button or text. Colors come from `currentColor`, so use `text-icon-*` on the icon or a parent.
 */
export function Icon({ name, size = 20, className, ...props }: IconProps) {
  const [w, h, d] = iconPaths[name]
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
      {...props}
    >
      <path d={d} />
    </svg>
  )
}

export const iconNames = Object.keys(iconPaths) as Array<IconName>
