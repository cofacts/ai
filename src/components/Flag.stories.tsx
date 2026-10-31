import { Flag } from './Flag'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/Flag',
  component: Flag,
  parameters: { penpot: { component: 'Base/Flag' } },
  args: { children: '有 999k 人想知道以下訊息的真實性' },
  decorators: [
    (Story) => <div className="bg-surface-base p-spacing-24">{Story()}</div>,
  ],
} satisfies Meta<typeof Flag>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
