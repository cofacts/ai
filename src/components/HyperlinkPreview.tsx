import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/** The fields of rumors-api `Hyperlink` this card shows. */
export type Hyperlink = {
  url: string
  title?: string | null
  summary?: string | null
}

/**
 * Penpot Content/LinkCard: the preview of a link in a reply's references — title, a summary with
 * a rule on its left, and the URL. The whole card is one link to `url` and opens in a new tab.
 *
 * Penpot's card has no picture, so rumors-api's `topImageUrl` isn't shown.
 */
export function HyperlinkPreview({
  hyperlink: { url, title, summary },
  className,
}: {
  hyperlink: Hyperlink
  className?: string
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex w-full flex-col gap-spacing-8 rounded-radius-10 bg-surface-raised p-spacing-20',
        className,
      )}
    >
      {title && (
        <span className="text-type-heading-xs text-text-primary">{title}</span>
      )}
      {summary && (
        // Penpot crops the summary at 6 lines on mobile and 3 on desktop.
        <span className="line-clamp-6 border-l-2 border-border-control pl-spacing-12 text-type-body-s text-text-primary md:line-clamp-3">
          {summary}
        </span>
      )}
      <span className="flex items-center gap-spacing-12">
        <MaterialIcon name="link" className="text-icon-muted" />
        <span className="min-w-0 text-type-caption wrap-anywhere text-text-secondary">
          {url}
        </span>
      </span>
    </a>
  )
}
