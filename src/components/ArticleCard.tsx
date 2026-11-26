import { useId } from 'react'
import { Link } from '@tanstack/react-router'

import {
  ArticleMedia,
  mediaFallbackText,
  useArticleThumbnail,
} from './ArticleMedia'
import { ExpandableText } from './ExpandableText'
import type { ArticleTypeEnum } from '@/server/gql/graphql'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { buttonVariants } from '@/components/ui/button'
import { formatDate, formatDateTime } from '@/lib/timeAgo'
import { cn } from '@/lib/utils'

export type ArticleCardProps = {
  /** rumors-api `articleType`. Decides what shows next to the text. */
  articleType: ArticleTypeEnum
  /** The message text. Collapsed to a few lines behind 閱讀全文 when it's long. */
  text: string
  /**
   * IMAGE and VIDEO: the thumbnail (rumors-api `attachmentUrl(variant: THUMBNAIL)`), a JPEG for
   * both. Until rumors-api#326, don't pass one for VIDEO: rumors-api answers THUMBNAIL for a
   * video with the original file, so a logged-in user gets the whole mp4, which the browser
   * would download before giving up on it as an image. When there is none, or it fails to load, a
   * placeholder says 無法預覽. Ignored for AUDIO, which never has a thumbnail and always
   * shows the placeholder, without 無法預覽.
   */
  thumbnailUrl?: string | null
  /** How many times the message was reported (rumors-api `replyRequestCount`). 「被回報 N 次」. */
  replyRequestCount: number
  /**
   * When the message was first reported (rumors-api `createdAt`, ISO string). 「最初回報於 3 小時前」
   * within 48 hours, the date after that, and the full time on hover.
   */
  createdAt: string | Date
  /**
   * The current time, passed in instead of read from the clock, so the server render and the
   * browser agree. See FactCheckReply.
   */
  now: string | Date
  /** Where 查核闢謠 goes: the message's page, `/article/:id`. */
  href: string
  className?: string
}

/**
 * [Penpot Content/FactCheckCard](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=2b0b3baa-1d83-80f3-8008-66e145628700) (desktop) and
 * [Content/FactCheckCard-Original-Mobile](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=4a16248d-0aca-8082-8008-721d75d9ae58) as one responsive
 * component: one reported message (訊息原文) with its image, how often it was reported, and
 * 查核闢謠.
 *
 * In Penpot's `Latest replies` the card is the top of a list item, with the message's
 * FactCheckReply cards under it; only the top corners are rounded for that reason. The page
 * puts them together, so this component shows only the message.
 *
 * It only shows what it's given: data comes in through props.
 */
export function ArticleCard({
  articleType,
  text,
  thumbnailUrl,
  replyRequestCount,
  createdAt,
  now,
  href,
  className,
}: ArticleCardProps) {
  // An unparseable date drops the date instead of throwing while rendering.
  const created = new Date(createdAt)
  const hasCreatedAt = !Number.isNaN(created.getTime())
  const textId = useId()
  const { shownThumbnail, onThumbnailError } = useArticleThumbnail(
    articleType,
    thumbnailUrl,
  )
  const fallback = mediaFallbackText(articleType, text, shownThumbnail)
  const describedBy = text || fallback ? textId : undefined

  return (
    <article
      className={cn(
        'flex w-full flex-col gap-spacing-20 rounded-t-radius-10 bg-surface-base p-spacing-20 md:gap-spacing-24 md:p-spacing-32',
        className,
      )}
    >
      <p className="text-type-heading-xs text-text-tertiary md:text-type-heading-s">
        訊息原文
      </p>

      <div className="flex flex-col gap-spacing-20 md:flex-row md:gap-spacing-24">
        <ArticleMedia
          articleType={articleType}
          text={text}
          thumbnailUrl={shownThumbnail}
          onThumbnailError={onThumbnailError}
        />
        {fallback && (
          <p
            id={textId}
            className="min-w-0 flex-1 text-type-body-s text-text-tertiary md:text-type-body-m"
          >
            {fallback}
          </p>
        )}
        {text && (
          // Clamped like Penpot's text box: 6 lines on mobile, 4 on desktop.
          <ExpandableText
            id={textId}
            clampClassName="line-clamp-6 md:line-clamp-4"
            className="min-w-0 flex-1"
          >
            {text}
          </ExpandableText>
        )}
      </div>

      <div className="flex flex-col gap-spacing-4 md:flex-row md:items-center md:justify-between">
        <p className="text-type-body-s text-text-secondary md:text-type-body-m">
          被回報 {replyRequestCount} 次
          {hasCreatedAt && (
            <>
              ｜最初回報於{' '}
              <time
                dateTime={created.toISOString()}
                title={formatDateTime(created)}
              >
                {formatDate(created, new Date(now))}
              </time>
            </>
          )}
        </p>
        {/*
          Penpot Base/Button, Size = Large with an icon, but it goes to another page, so it is a
          link styled as the button. Base UI's Button would give the <a> role="button".
          <Link> navigates inside the app, keeping the Query cache, like SiteNav's NavAnchor.
          A list has one 查核闢謠 per card, so the message text (or the line standing in for it)
          describes which one it opens.
        */}
        <Link
          to={href}
          aria-describedby={describedBy}
          className={cn(
            buttonVariants({ size: 'lg', withIcon: true }),
            'w-full md:w-auto',
          )}
        >
          查核闢謠
          <MaterialIcon name="arrow_forward" />
        </Link>
      </div>
    </article>
  )
}
