import { fn } from 'storybook/test'

import { AiButton } from './AiButton'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/AiButton',
  component: AiButton,
  parameters: { penpot: { component: 'Base/Button AI' } },
  args: { children: '查核回覆草稿', onClick: fn() },
} satisfies Meta<typeof AiButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithIcon: Story = { args: { icon: 'edit_document' } }
export const Loading: Story = {
  args: { icon: 'search', loading: true, children: '搜尋資料庫' },
}
export const Secondary: Story = {
  args: { variant: 'secondary', icon: 'link', children: '相關文章' },
}
export const Disabled: Story = { args: { disabled: true } }
