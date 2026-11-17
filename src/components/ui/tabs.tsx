import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

/**
 * Tabs pattern (`tablist` / `tab` / `tabpanel`, arrow keys, `aria-selected`) on Base UI.
 * Not in Penpot yet: a row of equal tabs over a 1px rule, the selected one with a brand-yellow
 * underline and bold text, so the selection doesn't rest on color alone.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-spacing-12', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      // Arrow keys select the tab they land on. Base UI's default needs Enter or Space as well.
      activateOnFocus
      className={cn('flex border-b border-border-subtle', className)}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        '-mb-px flex min-h-[36px] flex-1 cursor-pointer items-center justify-center gap-spacing-4 border-b-2 border-transparent px-spacing-8 py-spacing-8 text-type-ui-m whitespace-nowrap text-text-secondary',
        'hover:text-text-primary data-active:border-border-accent data-active:text-type-ui-m-bold data-active:text-text-primary',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel(props: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" {...props} />
}

export { Tabs, TabsList, TabsPanel, TabsTab }
