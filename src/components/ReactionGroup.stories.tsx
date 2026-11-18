import { expect, fn, userEvent, within } from 'storybook/test'

import { ReactionGroup } from './ReactionGroup'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/ReactionGroup',
  component: ReactionGroup,
  parameters: { penpot: { component: 'Feedback/ReactionGroup' } },
  args: {
    helpfulCount: 100,
    unhelpfulCount: 100,
    action: 'reason',
    onValueChange: fn(),
    onAction: fn(),
  },
} satisfies Meta<typeof ReactionGroup>

export default meta
type Story = StoryObj<typeof meta>

/** Type = reason, State = Default. */
export const Default: Story = {}

/** State = Up. */
export const Up: Story = { args: { defaultValue: 'up' } }

/** State = Down. */
export const Down: Story = { args: { defaultValue: 'down' } }

/** Type = report: the trailing action is a flag button. */
export const Report: Story = { args: { action: 'report' } }

/** Every Type × State, as on Penpot's Feedback board. */
export const All: Story = {
  render: (args) => (
    <div className="grid w-fit grid-cols-3 gap-spacing-16">
      {(['reason', 'report'] as const).map((action) =>
        ([null, 'up', 'down'] as const).map((value) => (
          <ReactionGroup
            key={`${action}-${value}`}
            {...args}
            action={action}
            defaultValue={value}
          />
        )),
      )}
    </div>
  ),
}

/** Pressing 讚 then 倒讚 moves the choice; pressing 倒讚 again clears it. */
export const Toggling: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: '讚 100' })
    const down = canvas.getByRole('button', { name: '倒讚 100' })

    await userEvent.click(up)
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await expect(args.onValueChange).toHaveBeenLastCalledWith('up')

    await userEvent.click(down)
    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await expect(down).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(down)
    await expect(down).toHaveAttribute('aria-pressed', 'false')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(null)
  },
}
