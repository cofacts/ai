import { useId } from 'react'
import { Link } from '@tanstack/react-router'

import {
  ArticleMedia,
  mediaFallbackText,
  useArticleThumbnail,
} from './ArticleMedia'
import { ExpandableText } from './ExpandableText'
import type { ArticleTypeEnum } from '@/server/gql/graphql'
import { formatDate, formatDateTime } from '@/lib/timeAgo'
import { cn } from '@/lib/utils'

export type DisputedMessageProps = {
  /** rumors-api `articleType`. Decides what shows next to the text. */
  articleType: ArticleTypeEnum
  /** The message text. Collapsed to a few lines behind 閱讀全文 when it's long. */
  text: string
  /**
   * IMAGE and VIDEO: the thumbnail, as in ArticleCard. Until rumors-api#326, don't pass one for
   * VIDEO (see ArticleCard's `thumbnailUrl`).
   */
  thumbnailUrl?: string | null
  /** How many replies the message has (rumors-api `replyCount`). 「回應」. */
  replyCount: number
  /** How many times the message was reported (rumors-api `replyRequestCount`). 「回報」. */
  replyRequestCount: number
  /**
   * When the message was first reported (rumors-api `createdAt`, ISO string). 「首次回報於 3 小時前」
   * within 48 hours, the date after that, and the full time on hover.
   */
  createdAt: string | Date
  /**
   * The current time, passed in instead of read from the clock, so the server render and the
   * browser agree. See FactCheckReply.
   */
  now: string | Date
  /** The message's page, `/article/:id`. The whole card links there. */
  href: string
  className?: string
}

/**
 * [Penpot Content/DisputedMessage](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=dcb2533c-c18c-80be-8008-68fe12c3bcb5) (desktop) and
 * [Content/DisputedMessage-Mobile](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=4a16248d-0aca-8082-8008-72329db359be) as one responsive
 * component: one message in the /articles list, with when it was first reported, how many
 * replies and reports it has, its image and its text. rumors-site's
 * `ListPageDisplays/ArticleCard`.
 *
 * The whole card opens the message's page, as on rumors-site. rumors-site wraps the card in the
 * `<a>`, which puts 閱讀全文 (a button) inside a link. Here the link is the 首次回報於 line, and
 * its `::after` covers the card, so a click anywhere opens the page while 閱讀全文 stays a
 * separate button, drawn above the link's cover. A keyboard reaches the link, then 閱讀全文.
 *
 * It only shows what it's given: data comes in through props.
 */
export function DisputedMessage({
  articleType,
  text,
  thumbnailUrl,
  replyCount,
  replyRequestCount,
  createdAt,
  now,
  href,
  className,
}: DisputedMessageProps) {
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
        'relative flex w-full flex-col gap-spacing-20 rounded-radius-10 bg-surface-base p-spacing-20 md:gap-spacing-24 md:p-spacing-32',
        className,
      )}
    >
      <p className="text-type-heading-xs text-text-tertiary md:text-type-heading-s">
        {/*
          The card's link. <Link> navigates inside the app and keeps the Query cache, like
          ArticleCard's 查核闢謠. Its ::after stretches over the card (the <article> is
          `relative`), so the whole card is clickable. Every card in a list starts with
          首次回報於, so the message text (or the line standing in for it) describes which one
          the link opens.
        */}
        <Link
          to={href}
          aria-describedby={describedBy}
          className="after:absolute after:inset-0 after:rounded-radius-10 after:content-['']"
        >
          首次回報於
          {hasCreatedAt && (
            <>
              {' '}
              <time
                dateTime={created.toISOString()}
                title={formatDateTime(created)}
              >
                {formatDate(created, new Date(now))}
              </time>
            </>
          )}
        </Link>
      </p>

      <div className="flex flex-col gap-spacing-20 md:flex-row md:items-start md:gap-spacing-24">
        <ReplyRequestStats
          replyCount={replyCount}
          replyRequestCount={replyRequestCount}
        />
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
          // Penpot's text box is 4 lines on desktop. On mobile it grows with Penpot's sample
          // text; 6 lines matches the mobile board and ArticleCard. 閱讀全文 sits above the
          // link's cover, so it expands the text instead of opening the page.
          <ExpandableText
            id={textId}
            clampClassName="line-clamp-6 md:line-clamp-4"
            className="min-w-0 flex-1 [&_button]:relative"
          >
            {text}
          </ExpandableText>
        )}
      </div>
    </article>
  )
}

/**
 * Penpot Feedback/ReportStatus: 回應 N｜回報 N. Desktop stacks each number over its label; mobile
 * puts them side by side across the card. A `<dl>` with the label first, so a screen reader
 * reads 「回應 0」; the order on screen is reversed.
 */
function ReplyRequestStats({
  replyCount,
  replyRequestCount,
}: Pick<DisputedMessageProps, 'replyCount' | 'replyRequestCount'>) {
  const stats = [
    { label: '回應', count: replyCount },
    { label: '回報', count: replyRequestCount },
  ]
  return (
    <dl className="flex shrink-0 justify-center gap-spacing-20 rounded-radius-10 bg-surface-raised px-spacing-24 py-spacing-12 md:py-spacing-20">
      {stats.map(({ label, count }, i) => (
        <div
          key={label}
          className={cn(
            'flex flex-1 flex-row-reverse items-center justify-center gap-spacing-8 md:min-w-[46px] md:flex-none md:flex-col-reverse md:gap-spacing-2',
            // Penpot's divider: a 1px border-control line, the full height, with the 20px gap on
            // each side. Drawn by the second item, since a <dl> can't hold a separator.
            i > 0 &&
              "relative ml-spacing-20 before:absolute before:inset-y-0 before:-left-[20.5px] before:w-px before:bg-border-control before:content-['']",
          )}
        >
          <dt className="text-type-ui-m-bold whitespace-nowrap text-text-primary">
            {label}
          </dt>
          <dd className="text-type-heading-l text-text-primary">{count}</dd>
        </div>
      ))}
    </dl>
  )
}
