import { fn } from 'storybook/test'

import { Button } from './button'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Button',
  component: Button,
  parameters: { penpot: { component: 'Base/Button' } },
  args: { children: '查核闢謠', onClick: fn() },
  /** Every story shows the lg / md / sm sizes side by side; `size` is ignored. */
  render: ({ size: _size, ...args }) => (
    <div className="flex flex-wrap items-center gap-spacing-16">
      {(['lg', 'md', 'sm'] as const).map((size) => (
        <Button key={size} {...args} size={size} />
      ))}
    </div>
  ),
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'outline', 'secondary', 'line', 'on-dark'],
    },
    size: { control: 'select', options: ['lg', 'md', 'sm', 'icon-touch'] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {}
export const Outline: Story = { args: { variant: 'outline' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Line: Story = {
  args: { variant: 'line', children: '用 LINE 查詢' },
}
export const WithIcons: Story = {
  args: { iconStart: 'edit-document', iconEnd: 'arrow-forward' },
}
export const Disabled: Story = { args: { disabled: true } }

export const IconOnly: Story = {
  args: { iconStart: 'search', children: undefined, 'aria-label': '搜尋' },
}

/** `icon-touch` is the 32px icon button used in the dark app bar. */
export const OnDark: Story = {
  args: {
    variant: 'on-dark',
    iconStart: 'menu',
    children: undefined,
    'aria-label': '選單',
  },
  render: (args) => (
    <div
      data-surface="dark"
      className="flex items-center gap-spacing-16 bg-surface-dark p-spacing-16"
    >
      <Button {...args} size="icon-touch" />
    </div>
  ),
}
