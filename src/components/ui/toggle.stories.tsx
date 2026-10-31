import { Toggle } from './toggle'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Toggle',
  component: Toggle,
  parameters: { penpot: { component: 'Base/Toggle' } },
  args: { children: '收藏', icon: 'bookmark' },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Pressed: Story = { args: { defaultPressed: true } }
export const Outline: Story = {
  args: { icon: undefined, children: '文字' },
}
export const Disabled: Story = { args: { disabled: true } }
