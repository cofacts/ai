import type { QuickNavItem } from '../-lib'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Penpot Layout/ActionPanel (快速索引). One `<nav aria-label="本頁索引">` of
 * anchor links: a column under a visible 「快速索引」 heading on desktop, a row
 * that scrolls sideways under the site nav on mobile. 「我要查核闢謠」 sits
 * outside the row: in the panel on desktop, floating at the bottom on mobile.
 */
export function ArticleQuickNav({
  items,
  checkHref,
  className,
}: {
  items: ReadonlyArray<QuickNavItem>
  /** Where 「我要查核闢謠」 goes; the button is left out until there is one. */
  checkHref?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'sticky top-[60px] z-20 lg:top-[88px] lg:self-start',
        className,
      )}
    >
      {/* Desktop only: the mobile row has no heading in Penpot. */}
      <h2 className="mb-spacing-8 hidden text-type-ui-m font-semibold text-text-primary lg:block">
        快速索引
      </h2>
      <nav
        aria-label="本頁索引"
        className="-mx-spacing-20 overflow-x-auto overscroll-x-contain border-b border-border-subtle bg-surface-base px-spacing-20 lg:mx-0 lg:overflow-visible lg:border-b-0 lg:px-0"
      >
        <ul className="flex gap-spacing-20 lg:flex-col lg:gap-spacing-4">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn('shrink-0', item.mobileOnly && 'lg:hidden')}
            >
              <a
                href={`#${item.id}`}
                className="flex min-h-[44px] items-center text-type-ui-m whitespace-nowrap text-text-secondary hover:text-text-primary lg:min-h-[36px]"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {checkHref && (
        <a
          href={checkHref}
          className={cn(
            buttonVariants({ variant: 'primary', size: 'lg' }),
            'fixed right-spacing-20 bottom-spacing-20 z-20 lg:static lg:mt-spacing-16 lg:w-full',
          )}
        >
          我要查核闢謠
        </a>
      )}
    </div>
  )
}
