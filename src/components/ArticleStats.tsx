import { cn } from '@/lib/utils'

export type ArticleStatsProps = {
  /** How many replies the message has (rumors-api `replyCount`). 「回應」. */
  replyCount: number
  /** How many times the message was reported (rumors-api `replyRequestCount`). 「回報」. */
  replyRequestCount: number
  className?: string
}

/**
 * Penpot Feedback/ReportStatus (`Device = Desktop / Mobile`) as one responsive component: 回應 N｜
 * 回報 N. Desktop stacks each number over its label; mobile puts them side by side across the
 * width it is given. A `<dl>` with the label first, so a screen reader reads 「回應 0」; the order
 * on screen is reversed.
 */
export function ArticleStats({
  replyCount,
  replyRequestCount,
  className,
}: ArticleStatsProps) {
  const stats = [
    { label: '回應', count: replyCount },
    { label: '回報', count: replyRequestCount },
  ]
  return (
    <dl
      className={cn(
        'flex shrink-0 justify-center gap-spacing-20 rounded-radius-10 bg-surface-raised px-spacing-24 py-spacing-12 md:py-spacing-20',
        className,
      )}
    >
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
