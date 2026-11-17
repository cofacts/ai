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
    docs: {
      description: {
        component:
          'The row of buttons only. ReplyFeedback has the same `parameters.penpot` and wraps this ' +
          'with the reason form and the reasons list: for a Feedback/ReactionGroup instance on a ' +
          'reply card or a message, use ReplyFeedback.',
      },
    },
  },
  render: (args) => (
    <Interactive key={`${args.type}-${args.ownVote ?? 'none'}`} {...args} />
  ),
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

/** Penpot Type = reason. Click the votes: the pressed one shows its solid icon in the brand yellow. */
export const Reason: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: '有幫助 100' })
    const down = canvas.getByRole('button', { name: '沒幫助 100' })

    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await expect(down).toHaveAttribute('aria-pressed', 'false')

    // Upvote
    await userEvent.click(up)
    await expect(args.onVote).toHaveBeenLastCalledWith('UPVOTE')
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await expect(down).toHaveAttribute('aria-pressed', 'false')

    // Switch to downvote
    await userEvent.click(down)
    await expect(args.onVote).toHaveBeenLastCalledWith('DOWNVOTE')
    await expect(down).toHaveAttribute('aria-pressed', 'true')
    await expect(up).toHaveAttribute('aria-pressed', 'false')

    // Retract downvote
    await userEvent.click(down)
    await expect(args.onVote).toHaveBeenLastCalledWith('NEUTRAL')
    await expect(down).toHaveAttribute('aria-pressed', 'false')
    await expect(up).toHaveAttribute('aria-pressed', 'false')

    // View reasons: a plain button, not a toggle
    const reasons = canvas.getByRole('button', { name: '看理由' })
    await expect(reasons).not.toHaveAttribute('aria-pressed')
    await userEvent.click(reasons)
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
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: '有幫助 100' }),
    ).toBeDisabled()
    await expect(
      canvas.getByRole('button', { name: '沒幫助 100' }),
    ).toBeDisabled()
    // Only the votes are disabled: 看理由 still works.
    await userEvent.click(canvas.getByRole('button', { name: '看理由' }))
    await expect(args.onShowReasons).toHaveBeenCalled()
  },
}
