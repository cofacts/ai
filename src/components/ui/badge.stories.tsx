import { fn } from 'storybook/test'

import { Badge } from './badge'
import { Chip } from './chip'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Badge',
  component: Badge,
  parameters: { penpot: { component: 'Base/Badge' } },
  args: { children: '還未有效查核' },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

/** Type = fix: static label. */
export const Fixed: Story = { args: { icon: 'error' } }

/** Type = normal / normal-active / disable: a filter chip (`Chip`, `<button aria-pressed>`). */
export const Chips: Story = {
  render: () => (
    <div className="flex flex-wrap gap-spacing-12">
      <Chip onPressedChange={fn()}># 標籤</Chip>
      <Chip defaultPressed># 已選取</Chip>
      <Chip disabled># 停用</Chip>
      <Chip icon="filter-list">還未有效查核</Chip>
      <Chip icon="filter-list" defaultPressed>
        還未有效查核
      </Chip>
    </div>
  ),
}
