import { cn } from '@/lib/utils'

/**
 * A suspicious message at a glance — enough text to recognise it, and whether
 * anyone has answered it yet.
 *
 * Two callers, two behaviours. RightDrawer's "similar messages" carousel links
 * out to cofacts.tw (`href`); the report form asks "is this the one you saw?"
 * and needs a button (`onSelect`). Exactly one of the two is given.
 */
type SuspiciousMessageCardProps = {
  text: string | null
  articleType: string
  /** 0 means nobody has answered it yet — the branch that offers a +1. */
  factCheckCount: number
  /** How many people asked for it to be checked. Omitted in the carousel. */
  communityDemandCount?: number | null
  className?: string
} & (
  | { href: string; onSelect?: never; selected?: never; disabled?: never }
  | {
      href?: never
      onSelect: () => void
      selected?: boolean
      /** While the caller is busy acting on a pick, so it cannot be repeated. */
      disabled?: boolean
    }
)

export function SuspiciousMessageCard({
  text,
  articleType,
  factCheckCount,
  communityDemandCount,
  className,
  href,
  onSelect,
  selected,
  disabled,
}: SuspiciousMessageCardProps) {
  const body = (
    <>
      <p className="flex-1 text-left text-type-caption line-clamp-4 whitespace-pre-wrap text-text-secondary">
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
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        shared,
        'w-full text-left hover:bg-surface-selected disabled:pointer-events-none disabled:opacity-50',
        selected && 'border-border-accent bg-surface-base',
        className,
      )}
    >
      {body}
    </button>
  )
}
