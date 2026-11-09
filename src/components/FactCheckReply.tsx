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
import { formatTimeAgo } from '@/lib/timeAgo'
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
  /** When the reply was written (rumors-api `createdAt`, ISO string). 「回應於 N 天前」. */
  createdAt: string | Date
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
 * Penpot Content/FactCheckReply (desktop) and Content/ReplyCard-Mobile as one responsive
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
          ? 'border border-border-accent'
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
          <ExpandableText defaultExpanded={defaultExpanded}>
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
                  // The server and the browser can land on either side of a unit boundary.
                  suppressHydrationWarning
                >
                  {formatTimeAgo(created)}
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
}: {
  children: string
  defaultExpanded: boolean
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
    <div className="flex flex-col items-start">
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
