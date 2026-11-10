import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { ReactionGroup } from './ReactionGroup'
import type { ReactionGroupProps } from './ReactionGroup'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

/**
 * The parent owns the vote state in the app, so the story plays the parent: pressing a vote
 * shows it, pressing it again takes it back, pressing the other one switches. `onVote` is still
 * called, so the Actions panel shows what the component sent.
 */
function Interactive(args: ReactionGroupProps) {
  const [ownVote, setOwnVote] = useState(args.ownVote)
  return (
    <ReactionGroup
      {...args}
      ownVote={ownVote}
      onVote={(vote) => {
        args.onVote?.(vote)
        setOwnVote(vote === 'NEUTRAL' ? null : vote)
      }}
    />
  )
}

const meta = {
  title: 'components/ReactionGroup',
  component: ReactionGroup,
  parameters: {
    penpot: { component: 'Feedback/ReactionGroup' },
    viewport: { options: viewportOptions },
  },
  render: (args) => <Interactive {...args} />,
  args: {
    type: 'reason',
    positiveCount: 100,
    negativeCount: 100,
    ownVote: null,
    onVote: fn(),
    onShowReasons: fn(),
    onReport: fn(),
  },
} satisfies Meta<typeof ReactionGroup>

export default meta
type Story = StoryObj<typeof meta>

/** Penpot Type = reason. Click the votes: pressed shows the strong border and yellow icon. */
export const Reason: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: '有幫助 100' })
    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(up)
    await expect(args.onVote).toHaveBeenLastCalledWith('UPVOTE')
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(up)
    await expect(args.onVote).toHaveBeenLastCalledWith('NEUTRAL')
    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(canvas.getByRole('button', { name: '看理由' }))
    await expect(args.onShowReasons).toHaveBeenCalled()
  },
}

/** Penpot Type = report: the last segment is the flag, 檢舉. */
export const Report: Story = {
  args: { type: 'report' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '檢舉' }),
    )
    await expect(args.onReport).toHaveBeenCalled()
  },
}

/** Votes disabled (R5: default look at 50% opacity, `disabled`). */
export const VoteDisabled: Story = {
  args: { voteDisabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: '有幫助 100' }),
    ).toBeDisabled()
  },
}

/** Base/Toggle hover, from Storybook pseudo-states. */
export const Hover: Story = { parameters: { pseudo: { hover: true } } }

/** Keyboard focus, from Storybook pseudo-states: the global focus ring on each segment. */
export const FocusVisible: Story = {
  parameters: { pseudo: { focusVisible: true } },
}
