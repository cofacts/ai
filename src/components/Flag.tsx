import { cn } from '@/lib/utils'

/**
 * Penpot Base/Flag: the yellow ribbon over a card, e.g.「有 999k 人想知道以下訊息的真實性」.
 * It hangs 8px out to the left of its container, with an orange fold under that edge
 * (surface-accent-fold, pure decoration) and a notched tail on the right.
 */
export function Flag({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('-ml-spacing-8 flex w-fit items-start', className)}>
      <span aria-hidden="true" className="flex w-spacing-8 flex-col">
        <span className="h-[36px] bg-surface-accent" />
        <span className="size-spacing-8 bg-surface-accent-fold [clip-path:polygon(0_0,100%_0,100%_100%)]" />
      </span>
      <p className="flex min-h-[36px] items-center bg-surface-accent px-spacing-4 py-spacing-8 text-type-ui-m-bold text-text-on-accent">
        {children}
      </p>
      <span
        aria-hidden="true"
        className="h-[36px] w-[26px] shrink-0 bg-surface-accent [clip-path:polygon(0_0,100%_0,62%_50%,100%_100%,0_100%)]"
      />
    </div>
  )
}
