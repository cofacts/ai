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
  | { href: string; onSelect?: never; selected?: never }
  | { href?: never; onSelect: () => void; selected?: boolean }
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
}: SuspiciousMessageCardProps) {
  const body = (
    <>
      <p className="text-xs text-gray-700 line-clamp-4 leading-relaxed flex-1 whitespace-pre-wrap text-left">
        {text || `[${articleType}]`}
      </p>
      <div className="flex items-center gap-1.5">
        {factCheckCount > 0 ? (
          <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
            {factCheckCount} 則查核
          </span>
        ) : (
          <span className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
            待查核
          </span>
        )}
        {communityDemandCount != null && (
          <span className="text-[10px] text-gray-400">
            {communityDemandCount} 人回報
          </span>
        )}
      </div>
    </>
  )

  const shared =
    'rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors flex flex-col gap-2'

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          shared,
          'shrink-0 w-[210px] hover:bg-gray-100',
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
      aria-pressed={selected}
      className={cn(
        shared,
        'w-full text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]',
        selected && 'border-[var(--primary)] bg-white',
        className,
      )}
    >
      {body}
    </button>
  )
}
