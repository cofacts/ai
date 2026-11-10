import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/** The fields of rumors-api `Hyperlink` this card shows. */
export type Hyperlink = {
  url: string
  title?: string | null
  summary?: string | null
}

/**
 * [Penpot Content/LinkCard](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=dcb2533c-c18c-80be-8008-6c1237e64815): the preview of a link in a reply's references — title, a summary with
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
  const classes = cn(
    'flex w-full flex-col gap-spacing-8 rounded-radius-10 bg-surface-raised p-spacing-20',
    className,
  )
  // The url is user-submitted. Anything but http(s) (javascript:, data:) shows as text, not a link.
  const content = (
    <>
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
    </>
  )
  return isHttpUrl(url) ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className={classes}>
      {content}
      <span className="sr-only">（另開新分頁）</span>
    </a>
  ) : (
    <div className={classes}>{content}</div>
  )
}

function isHttpUrl(url: string) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
