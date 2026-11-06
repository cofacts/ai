import { expect, fn, userEvent, within } from 'storybook/test'

import { desktop, mobile, viewportOptions } from '../../.storybook/viewports'
import { ReactionGroup } from './ReactionGroup'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/ReactionGroup',
  component: ReactionGroup,
  parameters: {
    penpot: { component: 'Feedback/ReactionGroup' },
    viewport: { options: viewportOptions },
  },
  globals: { ...desktop },
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

/** Penpot Type = reason. Pressing a vote sends it. */
export const Reason: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: '有幫助 100' })
    await expect(up).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(up)
    await expect(args.onVote).toHaveBeenLastCalledWith('UPVOTE')
    await userEvent.click(canvas.getByRole('button', { name: '看理由' }))
    await expect(args.onShowReasons).toHaveBeenCalled()
  },
}
export const ReasonDark: Story = { ...Reason, globals: { theme: 'dark' } }

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
export const ReportDark: Story = { ...Report, globals: { theme: 'dark' } }

/** ReplyCard-Mobile: full width, equal segments. */
export const Mobile: Story = {
  globals: { ...mobile },
  decorators: [
    (Story) => (
      <div className="p-spacing-16">
        <Story />
      </div>
    ),
  ],
}
export const MobileDark: Story = {
  ...Mobile,
  globals: { ...mobile, theme: 'dark' },
}

/**
 * Not in Penpot: the user voted 有幫助. Base/Toggle active (strong border, solid icon).
 * Pressing it again takes the vote back.
 */
export const VotedUp: Story = {
  args: { ownVote: 'UPVOTE', positiveCount: 101 },
  play: async ({ canvasElement, args }) => {
    const up = within(canvasElement).getByRole('button', {
      name: '有幫助 101',
    })
    await expect(up).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(up)
    await expect(args.onVote).toHaveBeenLastCalledWith('NEUTRAL')
  },
}
export const VotedUpDark: Story = { ...VotedUp, globals: { theme: 'dark' } }

/** Not in Penpot: the user voted 沒幫助; pressing 有幫助 switches the vote. */
export const VotedDown: Story = {
  args: { ownVote: 'DOWNVOTE', negativeCount: 101 },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '有幫助 100' }),
    )
    await expect(args.onVote).toHaveBeenLastCalledWith('UPVOTE')
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
export const HoverDark: Story = { ...Hover, globals: { theme: 'dark' } }

/** Keyboard focus, from Storybook pseudo-states: the global focus ring on each segment. */
export const FocusVisible: Story = {
  parameters: { pseudo: { focusVisible: true } },
}
export const FocusVisibleDark: Story = {
  ...FocusVisible,
  globals: { theme: 'dark' },
}
