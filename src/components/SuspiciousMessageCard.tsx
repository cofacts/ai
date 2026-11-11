import { useId } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A suspicious message at a glance — enough text to recognise it, and whether
 * anyone has answered it yet.
 *
 * Two callers, two behaviours. RightDrawer's "similar messages" carousel links
 * out to cofacts.tw (`href`: the whole card is a link). The report form asks
 * "is this the one you saw?" and picking has a side effect (a +1 when nobody has
 * answered yet), so the card is not itself a button: it offers a link to read the
 * article (`viewHref`) next to an explicit pick button (`onSelect`).
 */
type SuspiciousMessageCardProps = {
  text: string | null
  /**
   * The title scraped from the message's link, if any. A link alone rarely says
   * what it points at, and a search for a link also lists other posts from the
   * same site, so the title is what tells the candidates apart.
   */
  linkTitle?: string | null
  articleType: string
  /** 0 means nobody has answered it yet — the branch that offers a +1. */
  factCheckCount: number
  /** How many people asked for it to be checked. Omitted in the carousel. */
  communityDemandCount?: number | null
  className?: string
} & (
  | { href: string; viewHref?: never; onSelect?: never; disabled?: never }
  | {
      href?: never
      /** Where to read the article, opened in a new tab. */
      viewHref: string
      onSelect: () => void
      /** While the caller is busy acting on a pick, so it cannot be repeated. */
      disabled?: boolean
    }
)

export function SuspiciousMessageCard({
  text,
  linkTitle,
  articleType,
  factCheckCount,
  communityDemandCount,
  className,
  href,
  viewHref,
  onSelect,
  disabled,
}: SuspiciousMessageCardProps) {
  // Names the message each card's actions are about: every card's buttons
  // read the same, so a screen reader would otherwise hear five 就是這則.
  const textId = useId()
  const body = (
    <>
      {linkTitle && (
        <p className="text-left text-type-ui-s-bold line-clamp-2 wrap-anywhere text-text-primary">
          {linkTitle}
        </p>
      )}
      <p
        id={textId}
        className="flex-1 text-left text-type-caption line-clamp-4 whitespace-pre-wrap wrap-anywhere text-text-secondary"
      >
        {text || `[${articleType}]`}
      </p>
      <div className="flex items-center gap-spacing-8">
        {factCheckCount > 0 ? (
          <span className="rounded-radius-5 border border-border-subtle bg-surface-raised px-spacing-8 py-spacing-2 text-type-ui-xs text-status-correct">
            {factCheckCount} 則查核
          </span>
        ) : (
          <span className="rounded-radius-5 bg-surface-selected px-spacing-8 py-spacing-2 text-type-ui-xs text-text-secondary">
            待查核
          </span>
        )}
        {communityDemandCount != null && (
          <span className="text-type-ui-xs text-text-tertiary">
            {communityDemandCount} 人回報
          </span>
        )}
      </div>
    </>
  )

  const shared =
    'flex flex-col gap-spacing-8 rounded-radius-10 border border-border-subtle bg-surface-raised p-spacing-12 transition-colors'

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          shared,
          'w-[210px] shrink-0 hover:bg-surface-selected',
          className,
        )}
      >
        {body}
      </a>
    )
  }

  return (
    <div className={cn(shared, className)}>
      {body}
      <div className="flex flex-wrap items-center gap-spacing-8">
        <a
          href={viewHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          aria-describedby={textId}
        >
          查看這則訊息
        </a>
        <Button
          size="sm"
          onClick={onSelect}
          disabled={disabled}
          aria-describedby={textId}
        >
          就是這則
        </Button>
      </div>
    </div>
  )
}
