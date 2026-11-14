import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * One block of the article page that 本頁索引 links to. The id is the anchor;
 * the heading names the section for screen readers (`aria-labelledby`).
 */
export function ArticleSection({
  id,
  title,
  children,
  className,
}: {
  id: string
  title: string
  children: ReactNode
  className?: string
}) {
  const headingId = `${id}-heading`
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // Clears the sticky site nav (60 / 64px), plus the 本頁索引 row on mobile,
      // when the browser scrolls to the anchor.
      className={cn(
        'flex scroll-mt-[124px] flex-col gap-spacing-16 lg:scroll-mt-[88px]',
        className,
      )}
    >
      <h2 id={headingId} className="text-type-heading-m text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  )
}
