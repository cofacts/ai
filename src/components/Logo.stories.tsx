import { Logo } from './Logo'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/Logo',
  component: Logo,
  parameters: { penpot: { component: 'Layout/Logo' } },
} satisfies Meta<typeof Logo>

export default meta
type Story = StoryObj<typeof meta>

export const Symbol: Story = {}
export const Icon: Story = { args: { variant: 'icon' } }
export const OnDark: Story = {
  args: { onDark: true },
  decorators: [
    (Story) => <div className="bg-surface-dark p-spacing-16">{Story()}</div>,
  ],
}
