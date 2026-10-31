import { fn } from 'storybook/test'

import { Badge } from './badge'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { StatusIcon } from '@/components/icons/StatusIcon'

const meta = {
  title: 'ui/Badge',
  component: Badge,
  parameters: { penpot: { component: 'Base/Badge' } },
  args: { children: '# 標籤', onPressedChange: fn() },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

/** Type = normal. */
export const Normal: Story = {}

/** Type = normal-active: pressed. */
export const Pressed: Story = { args: { defaultPressed: true } }

/** Type = disable. */
export const Disabled: Story = { args: { disabled: true } }

/** Type = icon-default / icon-active: an icon before the text. Pressed, only the border goes away. */
export const WithIcon: Story = {
  args: {
    children: '含有不實訊息',
    icon: <StatusIcon type="RUMOR" className="size-[22px] md:size-[22px]" />,
  },
}

/** Every Type side by side, as on Penpot's Buttons board (except `fix`, which will go away). */
export const Types: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-spacing-12">
      <Badge># 標籤</Badge>
      <Badge defaultPressed># 標籤</Badge>
      <Badge disabled># 標籤</Badge>
      <Badge
        icon={
          <StatusIcon
            type="OPINIONATED"
            className="size-[22px] md:size-[22px]"
          />
        }
      >
        含有個人意見
      </Badge>
      <Badge
        defaultPressed
        icon={
          <StatusIcon type="NOT_RUMOR" className="size-[22px] md:size-[22px]" />
        }
      >
        含有正確訊息
      </Badge>
    </div>
  ),
}
