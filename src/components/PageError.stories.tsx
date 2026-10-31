import { fn } from 'storybook/test'

import { PageError } from './PageError'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/PageError',
  component: PageError,
  args: { reset: fn() },
} satisfies Meta<typeof PageError>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
