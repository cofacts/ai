import { useEffect, useId, useRef, useState } from 'react'

import { FactCheckReplyTitle } from './FactCheckReplyTitle'
import { HyperlinkPreview } from './HyperlinkPreview'
import { ReactionGroup } from './ReactionGroup'
import { UserAvatar } from './UserAvatar'
import type { ReactNode } from 'react'
import type { ReplyType } from './FactCheckReplyTitle'
import type { Hyperlink } from './HyperlinkPreview'
import type { ReactionGroupProps, ReplyVote } from './ReactionGroup'
import type { CofactsUser } from '@/lib/auth'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { Button } from '@/components/ui/button'
import { splitLinks } from '@/lib/linkify'
import { formatDate, formatDateTime } from '@/lib/timeAgo'
import { cn } from '@/lib/utils'

export type FactCheckReplyProps = {
  /**
   * Penpot Type. `with-link` adds the 資料佐證 section (reference text and link previews), a
   * brand-yellow border, and 分享 / 檢舉 buttons on desktop; its avatar has no level.
   */
  variant?: 'default' | 'with-link'
  replyType: ReplyType
  /** The reply's author. `level` shows as「Lv N」under the avatar in the default variant. */
  author: Pick<
    CofactsUser,
    'name' | 'avatarUrl' | 'avatarType' | 'avatarData'
  > & {
    level?: number | null
  }
  /** The reply text. Collapsed to a few lines behind 閱讀全文 when it's long. */
  text: string
  /**
   * When the reply was written (rumors-api `createdAt`, ISO string). 「回應於 3 小時前」 within
   * 48 hours, the date after that (「回應於 11月4日」), and the full time on hover.
   */
  createdAt: string | Date
  /**
   * The current time, passed in instead of read from the clock. `formatDate` uses it to decide
   * between 「3 小時前」 and a date, and whether the date needs a year. The route loader takes it
   * once and passes it down, so the server render and the browser agree; `new Date()` here would
   * differ between them.
   */
  now: string | Date
  /** How many messages use this reply. 「被引用 N 次」. */
  citationCount: number
  /** with-link: the reference text. URLs in it become links. */
  reference?: string | null
  /** with-link: previews of the links in `reference`. */
  hyperlinks?: ReadonlyArray<Hyperlink> | null
  /** Counts and the current user's vote for the ReactionGroup. */
  feedback: Pick<
    ReactionGroupProps,
    'positiveCount' | 'negativeCount' | 'ownVote' | 'voteDisabled'
  >
  /** See ReactionGroup: pressing your own vote again sends NEUTRAL. */
  onVote?: (vote: ReplyVote) => void
  /** 看理由. */
  onShowReasons?: () => void
  /** with-link: 分享. */
  onShare?: () => void
  /** with-link: the flag button, 檢舉. */
  onReport?: () => void
  /** Start with the whole text shown. */
  defaultExpanded?: boolean
  className?: string
}

/**
 * [Penpot Content/FactCheckReply](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=f402ced6-616c-80b4-8008-6d27620b7d42) (desktop) and
 * [Content/ReplyCard-Mobile](https://design.penpot.app/?screen=workspace&team-id=1710bc7f-8249-8127-8007-d006475d6947&file-id=81f57451-85cc-819d-8008-71f291481dd2&page-id=86907e95-1cb8-8122-8008-4f4d51befa98&layout=layers&board-id=4a16248d-0aca-8082-8008-724112c375ea) as one responsive
 * component: one reply with its result, text, author, and feedback. Mobile drops the avatar and
 * stacks the date line over a full-width ReactionGroup.
 *
 * It only shows what it's given: data comes in through props, and actions go out through the
 * callbacks.
 */
export function FactCheckReply({
  variant = 'default',
  replyType,
  author,
  text,
  createdAt,
  now,
  citationCount,
  reference,
  hyperlinks,
  feedback,
  onVote,
  onShowReasons,
  onShare,
  onReport,
  defaultExpanded = false,
  className,
}: FactCheckReplyProps) {
  const withLink = variant === 'with-link'
  const titleId = useId()
  const hasReferences = Boolean(reference || hyperlinks?.length)
  // An unparseable date drops the date line instead of throwing while rendering.
  const created = new Date(createdAt)
  const hasCreatedAt = !Number.isNaN(created.getTime())

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'flex w-full bg-surface-base p-spacing-20 md:gap-spacing-48 md:px-spacing-32 md:py-spacing-24',
        withLink
          ? // Penpot's mobile with-link has gray 1px lines above and below the yellow frame.
            'border border-border-accent shadow-[0_-1px_0_var(--color-border-control),0_1px_0_var(--color-border-control)] md:shadow-none'
          : 'border-y border-border-control',
        className,
      )}
    >
      <div className="hidden shrink-0 md:block">
        <UserAvatar
          user={author}
          size={withLink ? 60 : 68}
          level={withLink ? undefined : (author.level ?? undefined)}
        />
      </div>

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-spacing-16',
          withLink && 'md:gap-spacing-12',
        )}
      >
        <div className="flex flex-col gap-spacing-16">
          <div id={titleId}>
            <FactCheckReplyTitle type={replyType} author={author.name ?? ''} />
          </div>
          {/* Penpot: desktop with-link has 16px above 閱讀全文; the other three variants have none. */}
          <ExpandableText
            defaultExpanded={defaultExpanded}
            className={withLink ? 'md:gap-spacing-16' : undefined}
          >
            {text}
          </ExpandableText>
        </div>

        {withLink && hasReferences && (
          <>
            <hr className="border-t border-dashed border-border-control" />
            <p className="text-type-heading-xs text-text-primary">資料佐證</p>
            {reference && (
              <p className="text-type-body-m whitespace-pre-line wrap-anywhere text-text-primary">
                {linkify(reference)}
              </p>
            )}
            {hyperlinks?.map((hyperlink, i) => (
              <HyperlinkPreview
                key={`${i}:${hyperlink.url}`}
                hyperlink={hyperlink}
              />
            ))}
          </>
        )}

        <div className="flex flex-col gap-spacing-16 md:flex-row md:items-center md:justify-between">
          <p className="text-type-body-s text-text-secondary md:text-type-body-m">
            {hasCreatedAt && (
              <>
                回應於{' '}
                <time
                  dateTime={created.toISOString()}
                  title={formatDateTime(created)}
                >
                  {formatDate(created, new Date(now))}
                </time>
                ｜
              </>
            )}
            被引用 {citationCount} 次
          </p>
          <div className="flex w-full md:w-auto md:gap-spacing-20">
            <ReactionGroup
              {...feedback}
              onVote={onVote}
              onShowReasons={onShowReasons}
            />
            {withLink && (
              <>
                {/* Penpot ReplyCard-Mobile has no 分享 or 檢舉. */}
                <Button
                  variant="outline"
                  className="hidden md:inline-flex"
                  onClick={onShare}
                >
                  分享
                </Button>
                {/*
                  Base/Button Icon = Only with Penpot's solid flag (flag_2, filled). Button's
                  iconStart has no filled option, so the icon is a child and the classes are
                  the ones Button uses for an icon-only md button.
                */}
                <Button
                  variant="outline"
                  aria-label="檢舉"
                  className="hidden size-[36px] p-spacing-8 md:inline-flex"
                  onClick={onReport}
                >
                  <MaterialIcon name="flag_2" filled />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * The reply text, clamped like Penpot's text box (8 lines on mobile, 3 on desktop) with
 * 閱讀全文 under it. The button only shows when the text is cut off; once expanded it reads
 * 收合全文, rumors-site's wording, since Penpot doesn't draw the expanded state.
 */
function ExpandableText({
  children,
  defaultExpanded,
  className,
}: {
  children: string
  defaultExpanded: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  // Starts false so a short reply never shows 閱讀全文; a long one gets it once measured.
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const textId = useId()

  useEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [expanded, children])

  return (
    <div className={cn('flex flex-col items-start', className)}>
      <p
        ref={textRef}
        id={textId}
        className={cn(
          'text-type-body-s whitespace-pre-line wrap-anywhere text-text-primary md:text-type-body-m',
          !expanded && 'line-clamp-8 md:line-clamp-3',
        )}
      >
        {children}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-spacing-4 text-type-ui-s text-text-link md:text-type-ui-m"
        >
          {expanded ? '收合全文' : '閱讀全文'}
          <MaterialIcon name={expanded ? 'arrow_drop_up' : 'arrow_drop_down'} />
        </button>
      )}
    </div>
  )
}

/** Plain text with each http(s) URL turned into a link that opens in a new tab. */
function linkify(text: string): Array<ReactNode> {
  return splitLinks(text).map((part, i) =>
    part.type === 'link' ? (
      <a
        key={i}
        href={part.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-link"
      >
        {part.value}
      </a>
    ) : (
      part.value
    ),
  )
}
