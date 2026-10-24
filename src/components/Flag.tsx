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
    <div className={cn('-ml-8 flex w-fit items-start', className)}>
      <span aria-hidden="true" className="flex w-8 flex-col">
        <span className="h-36 bg-accent" />
        <span className="size-8 bg-accent-fold [clip-path:polygon(0_0,100%_0,100%_100%)]" />
      </span>
      <p className="flex min-h-36 items-center bg-accent px-4 py-8 text-ui-m-bold text-on-accent">
        {children}
      </p>
      <span
        aria-hidden="true"
        className="h-36 w-26 shrink-0 bg-accent [clip-path:polygon(0_0,100%_0,62%_50%,100%_100%,0_100%)]"
      />
    </div>
  )
}
