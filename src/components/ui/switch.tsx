import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@/lib/utils'

/** Penpot Base/Switch: 30×16 track, 16px thumb. Renders `role="switch" aria-checked`. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      // A native <button> is labelable, so a wrapping <label> names it.
      nativeButton
      render={<button type="button" />}
      className={cn(
        'relative inline-flex h-16 w-30 shrink-0 items-center rounded-full border border-strong bg-selected',
        'after:absolute after:-inset-8 data-checked:bg-accent-subtle',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-16 -translate-x-1 rounded-full bg-inverse transition-transform data-checked:translate-x-13 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
