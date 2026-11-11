import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Grey placeholder blocks while a part of the page loads. */
export function Skeleton({
  label,
  blocks,
}: {
  /** Read out while loading, e.g. 「正在載入貢獻紀錄」. */
  label: string
  /** Tailwind height (and shape) classes, one block each. */
  blocks: ReadonlyArray<string>
}) {
  return (
    <div aria-busy="true" className="flex flex-col gap-spacing-12">
      <span className="sr-only">{label}</span>
      {blocks.map((className, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn('rounded-radius-10 bg-surface-raised', className)}
        />
      ))}
    </div>
  )
}

/** A part of the page that couldn't load: says so and offers to retry, the rest keeps working. */
export function LoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-spacing-12 rounded-radius-10 bg-surface-raised p-spacing-16"
    >
      <p className="text-type-body-m text-text-secondary">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        重新載入
      </Button>
    </div>
  )
}
