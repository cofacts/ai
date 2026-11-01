import { fn } from 'storybook/test'

import { LoginModal } from './LoginModal'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/LoginModal',
  component: LoginModal,
  args: { open: true, onOpenChange: fn() },
} satisfies Meta<typeof LoginModal>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}
