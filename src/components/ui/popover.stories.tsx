import { expect, within } from 'storybook/test'

import { Popover, PopoverContent, PopoverTrigger } from './popover'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { FeedbackPopoverContent } from '@/components/FeedbackPopoverContent'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

const meta = {
  title: 'ui/Popover',
  component: Popover,
  tags: ['not-in-penpot'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "**Not in Penpot.** shadcn's Popover with Cofacts tokens. The app uses it for the feedback form after 👍 / 👎 on an AI reply (`FeedbackButtons`). Penpot has Feedback/ReactionGroup, but no popup. To discuss with the designer: keep it as is, or add it to Penpot.",
      },
    },
  },
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

/** The 👎 feedback form, as in `FeedbackButtons`. The play function opens it. */
export const Default: Story = {
  render: () => (
    <div className="min-h-[420px]">
      <Popover>
        <PopoverTrigger
          aria-label="沒有幫助"
          className="rounded-radius-5 p-spacing-4 text-text-tertiary hover:bg-surface-raised"
        >
          <MaterialIcon name="thumb_down" size={24} />
        </PopoverTrigger>
        <PopoverContent align="start">
          <FeedbackPopoverContent isPositive={false} onSubmit={() => {}} />
        </PopoverContent>
      </Popover>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '沒有幫助' }))
    await expect(await within(document.body).findByRole('dialog')).toBeVisible()
  },
}
