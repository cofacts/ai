import { fn } from 'storybook/test'

import { Button } from './button'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Button',
  component: Button,
  parameters: { penpot: { component: 'Base/Button' } },
  args: { children: '查核闢謠', onClick: fn() },
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

/** Penpot Size × Style × Icon, side by side. */
export const Matrix: Story = {
  render: () => (
    <div className="flex flex-col gap-24">
      {(['primary', 'outline', 'secondary'] as const).map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-16">
          {(['lg', 'md', 'sm'] as const).map((size) => (
            <Button key={size} variant={variant} size={size}>
              查核闢謠
            </Button>
          ))}
          <Button variant={variant} iconStart="edit-document">
            查核闢謠
          </Button>
          <Button variant={variant} iconEnd="arrow-forward">
            查核闢謠
          </Button>
          <Button variant={variant} iconStart="search" aria-label="搜尋" />
          <Button
            variant={variant}
            size="sm"
            iconStart="close"
            aria-label="關閉"
          />
          <Button variant={variant} disabled>
            停用
          </Button>
        </div>
      ))}
      <div
        data-surface="dark"
        className="flex items-center gap-16 bg-dark p-16"
      >
        <Button
          variant="on-dark"
          size="icon-touch"
          iconStart="menu"
          aria-label="選單"
        />
        <Button
          variant="on-dark"
          size="icon-touch"
          iconStart="close"
          aria-label="關閉"
        />
      </div>
    </div>
  ),
}
