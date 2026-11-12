import { useState } from 'react'

import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/** The fields of rumors-api `Hyperlink` this card shows. */
export type Hyperlink = {
  url: string
  title?: string | null
  summary?: string | null
  topImageUrl?: string | null
}

/**
 * [Penpot Content/LinkCard](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=dcb2533c-c18c-80be-8008-6c1237e64815): the preview of a link in a reply's references — title, a summary with
 * a rule on its left, and the URL. The whole card is one link to `url` and opens in a new tab.
 *
 * Not in Penpot yet: the thumbnail of `topImageUrl` on the right of the summary. It follows
 * cofacts.tw (rumors-site `components/Hyperlinks.js`) until the designer decides on it
 * (https://github.com/cofacts/ai/pull/190#discussion_r4537532404).
 */
export function HyperlinkPreview({
  hyperlink: { url, title, summary, topImageUrl },
  className,
}: {
  hyperlink: Hyperlink
  className?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const imageUrl =
    topImageUrl && isHttpUrl(topImageUrl) && !imageFailed ? topImageUrl : null
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
      {(summary || imageUrl) && (
        <span className="flex gap-spacing-12 border-l-2 border-border-control pl-spacing-12">
          {summary && (
            // Penpot crops the summary at 6 lines on mobile and 3 on desktop.
            <span className="line-clamp-6 min-w-0 flex-1 text-type-body-s text-text-primary md:line-clamp-3">
              {summary}
            </span>
          )}
          {imageUrl && (
            // Decorative: the title already names the link. The image comes from a third-party
            // page, so it loads lazily, sends no referrer, and is dropped when it fails to load.
            // A placeholder until the designer decides on the image. For now it copies cofacts.tw,
            // which crops the image into a box about 60 wide. Since our summary can run longer,
            // the box is a 64×64 square for now, 64 being the nearest spacing token to 60.
            // The ref catches a failure that happened before hydration attached onError.
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="ml-auto size-spacing-64 shrink-0 self-start rounded-radius-5 object-cover"
              onError={() => setImageFailed(true)}
              ref={(img) => {
                if (img?.complete && img.naturalWidth === 0)
                  setImageFailed(true)
              }}
            />
          )}
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
