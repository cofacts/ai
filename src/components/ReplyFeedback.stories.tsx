import { useState } from 'react'
import { expect, fn, mocked, userEvent, waitFor, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { ReplyFeedback } from './ReplyFeedback'
import type { ReplyFeedbackProps, ReplyFeedbackReason } from './ReplyFeedback'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

/**
 * The parent owns the vote in the app, so the story plays the parent: once `onSubmitVote`
 * resolves it shows the vote that was saved, and a NEUTRAL takes it back. `onSubmitVote` is
 * still called, so the Actions panel shows what the component sent.
 */
function Interactive(args: ReplyFeedbackProps) {
  const [ownVote, setOwnVote] = useState(args.ownVote)
  return (
    <ReplyFeedback
      {...args}
      ownVote={ownVote}
      onSubmitVote={async (input) => {
        await args.onSubmitVote(input)
        setOwnVote(input.vote === 'NEUTRAL' ? null : input.vote)
      }}
    />
  )
}

/** The reason form is in a popover, which renders outside the story's canvas. */
const popoverOf = (canvasElement: HTMLElement) =>
  within(canvasElement.ownerDocument.body)

const meta = {
  title: 'components/ReplyFeedback',
  component: ReplyFeedback,
  parameters: {
    penpot: { component: 'Feedback/ReactionGroup' },
    viewport: { options: viewportOptions },
    docs: {
      description: {
        component:
          'Penpot Feedback/ReactionGroup plus what Penpot does not draw, ported from rumors-site ' +
          '(`ArticleReplyFeedbackControl`): a vote first asks for a reason, in a popover under the ' +
          'buttons, and is sent with it; pressing the vote you gave takes it back at once. The ' +
          'reason form is not in Penpot, so its stories are tagged `not-in-penpot`. It goes on ' +
          'every reply card, next to the reply.',
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
    onSubmitVote: fn(async () => {}),
  },
} satisfies Meta<typeof ReplyFeedback>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Penpot Type = reason. Votes are sent with a reason: upvote, type one, send. The thumb shows
 * as pressed once it is saved, and pressing it again takes it back without asking.
 */
export const Reason: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = popoverOf(canvasElement)
    const up = canvas.getByRole('button', { name: '有幫助 100' })

    await expect(up).toHaveAttribute('aria-pressed', 'false')

    // Asks first: nothing is sent and nothing is pressed yet.
    await userEvent.click(up)
    const reason = await body.findByRole('textbox', {
      name: '還有什麼想補充的嗎？',
    })
    await expect(args.onSubmitVote).not.toHaveBeenCalled()
    await expect(up).toHaveAttribute('aria-pressed', 'false')

    await userEvent.type(reason, '有附上出處')
    await userEvent.click(body.getByRole('button', { name: '送出' }))
    await expect(args.onSubmitVote).toHaveBeenLastCalledWith({
      vote: 'UPVOTE',
      comment: '有附上出處',
    })
    await waitFor(() => expect(up).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(body.queryByRole('textbox')).toBeNull())
    await expect(canvas.getByRole('status')).toHaveTextContent('感謝你的回饋')

    // Taking it back asks nothing.
    await userEvent.click(up)
    await expect(args.onSubmitVote).toHaveBeenLastCalledWith({
      vote: 'NEUTRAL',
    })
    await waitFor(() => expect(up).toHaveAttribute('aria-pressed', 'false'))
    await expect(body.queryByRole('textbox')).toBeNull()
  },
}

/**
 * The ReactionGroup instance in Content/MessageListItem: its last segment is overridden with a
 * flag. The flag is 檢舉 and calls `onReport`; the parent opens the report form.
 */
export const Report: Story = {
  args: { type: 'report', onReport: fn() },
  play: async ({ canvasElement, args }) => {
    const report = within(canvasElement).getByRole('button', { name: '檢舉' })
    await expect(report).toBeVisible()
    await userEvent.click(report)
    await expect(args.onReport).toHaveBeenCalledTimes(1)
  },
}

/**
 * Not in Penpot. A downvote asks why. Esc closes the form without sending and puts the focus
 * back on the button that opened it. Pressing the thumb again also closes it; what was typed is
 * kept for that vote, and choosing the other vote starts empty.
 */
export const DownvoteForm: Story = {
  tags: ['not-in-penpot'],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = popoverOf(canvasElement)
    const down = canvas.getByRole('button', { name: '沒幫助 100' })
    const up = canvas.getByRole('button', { name: '有幫助 100' })

    await userEvent.click(down)
    await body.findByRole('textbox', { name: '為什麼你覺得沒有幫助？' })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('textbox')).toBeNull())
    await expect(args.onSubmitVote).not.toHaveBeenCalled()
    await expect(down).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(down).toHaveFocus())

    // The thumb closes its own form and keeps the draft.
    await userEvent.click(down)
    await userEvent.type(
      await body.findByRole('textbox', { name: '為什麼你覺得沒有幫助？' }),
      '沒有出處',
    )
    await userEvent.click(down)
    await waitFor(() => expect(body.queryByRole('textbox')).toBeNull())
    await userEvent.click(down)
    await expect(
      await body.findByRole('textbox', { name: '為什麼你覺得沒有幫助？' }),
    ).toHaveValue('沒有出處')

    // The other vote starts empty.
    await userEvent.click(up)
    await expect(
      await body.findByRole('textbox', { name: '還有什麼想補充的嗎？' }),
    ).toHaveValue('')
    await expect(args.onSubmitVote).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('textbox')).toBeNull())
  },
}

/**
 * Not in Penpot. Saving fails: the form stays open with what was typed and says so. Closing the
 * form clears the message; voting again brings back what was typed, and sending again works.
 */
export const SendFails: Story = {
  tags: ['not-in-penpot'],
  // Storybook resets every `fn()` before a story renders, so the failure is set here, after.
  beforeEach: ({ args }) => {
    mocked(args.onSubmitVote).mockRejectedValueOnce(new Error('network'))
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = popoverOf(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: '有幫助 100' }))
    await userEvent.type(await body.findByRole('textbox'), '寫了很久')
    await userEvent.click(body.getByRole('button', { name: '送出' }))

    await expect(await body.findByRole('alert')).toHaveTextContent('送出失敗')
    await expect(body.getByRole('textbox')).toHaveValue('寫了很久')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('textbox')).toBeNull())
    await expect(body.queryByRole('alert')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: '有幫助 100' }))
    await expect(await body.findByRole('textbox')).toHaveValue('寫了很久')
    await userEvent.click(body.getByRole('button', { name: '送出' }))
    await waitFor(() => expect(body.queryByRole('textbox')).toBeNull())
    await expect(args.onSubmitVote).toHaveBeenCalledTimes(2)
    await expect(
      canvas.getByRole('button', { name: '有幫助 100' }),
    ).toHaveAttribute('aria-pressed', 'true')
  },
}

/** Not in Penpot. Your own reply: you can't vote on it, so both votes are disabled. */
export const OwnReply: Story = {
  tags: ['not-in-penpot'],
  args: { voteDisabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const up = canvas.getByRole('button', { name: '有幫助 100' })

    await expect(up).toBeDisabled()
    await expect(
      canvas.getByRole('button', { name: '沒幫助 100' }),
    ).toBeDisabled()
    await userEvent.click(up, { pointerEventsCheck: 0 })
    await expect(
      popoverOf(canvasElement).queryByRole('textbox'),
    ).not.toBeInTheDocument()
    await expect(args.onSubmitVote).not.toHaveBeenCalled()
  },
}

/** A user without a network request: OpenPeeps draws the avatar in the browser. */
const peep = (name: string): ReplyFeedbackReason['user'] => ({
  name,
  avatarUrl: null,
  avatarType: 'OpenPeeps',
  avatarData: JSON.stringify({
    accessory: 'None',
    body: 'Shirt',
    face: 'Smile',
    hair: 'ShortCurly',
    facialHair: 'None',
    backgroundColorIndex: 0.3,
    flip: false,
  }),
})

const reasonFixtures: Array<ReplyFeedbackReason> = [
  {
    id: 'a',
    vote: 'UPVOTE',
    comment: null,
    createdAt: '2026-11-03T00:00:00Z',
    user: peep('小明'),
  },
  {
    id: 'b',
    vote: 'UPVOTE',
    comment: '出處很清楚，連結也打得開。',
    createdAt: '2026-11-01T00:00:00Z',
    user: peep('阿花'),
    reportHref: 'https://example.com/report?id=b',
  },
  {
    id: 'c',
    vote: 'UPVOTE',
    comment: '有附上衛福部的新聞稿。\n第二行也要保留。',
    createdAt: '2026-11-02T00:00:00Z',
    user: peep('小美'),
  },
  {
    id: 'd',
    vote: 'DOWNVOTE',
    comment:
      '網址 https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 失效了',
    createdAt: '2026-11-04T00:00:00Z',
    user: peep('路人甲'),
    reportHref: 'https://example.com/report?id=d',
  },
  {
    id: 'e',
    vote: 'DOWNVOTE',
    comment: '原文已經下架了。',
    createdAt: '2026-11-03T00:00:00Z',
    // A deleted account.
    user: null,
  },
]

const reasonsOpen = async (canvasElement: HTMLElement) => {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: '看理由' }),
  )
  return popoverOf(canvasElement)
}

/**
 * Not in Penpot. 看理由: a popover under the buttons, with a tab for each vote. People who left
 * a comment come first, the newest first. Arrow keys switch tabs. Only a comment gets a 檢舉
 * link, and only when the parent gave it a `reportHref`. A reason whose user is gone shows
 * 匿名使用者.
 */
export const ReasonsList: Story = {
  tags: ['not-in-penpot'],
  args: {
    reasons: { status: 'success', feedbacks: reasonFixtures },
    onLoadReasons: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const body = await reasonsOpen(canvasElement)
    await expect(args.onLoadReasons).toHaveBeenCalledTimes(1)

    // The popover mounts its content again as it opens, so look the tab up each time.
    const upTab = () => body.getByRole('tab', { name: '有幫助 100' })
    await body.findByRole('tab', { name: '有幫助 100' })
    await waitFor(() =>
      expect(upTab()).toHaveAttribute('aria-selected', 'true'),
    )

    // Comments first (newest first), then the one without a comment.
    const list = body.getByRole('region', { name: '有幫助的理由' })
    const text = list.textContent
    await expect(text.indexOf('小美')).toBeGreaterThanOrEqual(0)
    await expect(text.indexOf('小美')).toBeLessThan(text.indexOf('阿花'))
    await expect(text.indexOf('阿花')).toBeLessThan(text.indexOf('小明'))
    await expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await waitFor(() =>
      expect(within(list).getByText(/第二行也要保留/)).toBeVisible(),
    )
    // One report link: only 阿花's comment has a reportHref.
    await expect(
      within(list).getAllByRole('link', { name: /檢舉/ }),
    ).toHaveLength(1)
    await expect(
      within(list).getByRole('link', { name: /檢舉/ }),
    ).toHaveAttribute('target', '_blank')

    // Arrow keys move to the other tab.
    upTab().focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() =>
      expect(body.getByRole('tab', { name: '沒幫助 100' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    await waitFor(() =>
      expect(
        within(body.getByRole('region', { name: '沒幫助的理由' })).getByText(
          /失效了/,
        ),
      ).toBeVisible(),
    )
    await expect(
      within(body.getByRole('region', { name: '沒幫助的理由' })).getByText(
        '匿名使用者',
      ),
    ).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('tab')).toBeNull())
  },
}

const manyReasons: Array<ReplyFeedbackReason> = Array.from(
  { length: 12 },
  (_, i) => ({
    id: `m${i}`,
    vote: 'UPVOTE',
    comment: `理由 ${String(i + 1).padStart(2, '0')}`,
    // Later numbers are older, so the list reads 01, 02, ...
    createdAt: new Date(Date.UTC(2026, 10, 30 - i)).toISOString(),
    user: peep(`使用者 ${i + 1}`),
  }),
)

/**
 * Not in Penpot. Ten reasons per vote, then 載入更多 shows the rest. Pressing 看理由 again closes
 * the list without fetching it again.
 */
export const ReasonsLoadMore: Story = {
  tags: ['not-in-penpot'],
  args: {
    reasons: { status: 'success', feedbacks: manyReasons },
    onLoadReasons: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const body = await reasonsOpen(canvasElement)
    const list = await body.findByRole('region', { name: '有幫助的理由' })

    await expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    await userEvent.click(body.getByRole('button', { name: '載入更多' }))
    await expect(within(list).getAllByRole('listitem')).toHaveLength(12)
    await expect(body.queryByRole('button', { name: '載入更多' })).toBeNull()

    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '看理由' }),
    )
    await waitFor(() =>
      expect(body.queryByRole('region', { name: '有幫助的理由' })).toBeNull(),
    )
    await expect(args.onLoadReasons).toHaveBeenCalledTimes(1)
  },
}

/** Not in Penpot. The parent is still fetching the reasons. */
export const ReasonsLoading: Story = {
  tags: ['not-in-penpot'],
  args: { reasons: { status: 'loading', feedbacks: [] } },
  play: async ({ canvasElement }) => {
    const body = await reasonsOpen(canvasElement)
    // The popover fades in, so it isn't visible right away.
    await waitFor(async () =>
      expect(await body.findByText('載入中…')).toBeVisible(),
    )
  },
}

/** Not in Penpot. Fetching failed: 重試 asks the parent to load again. */
export const ReasonsError: Story = {
  tags: ['not-in-penpot'],
  args: {
    reasons: { status: 'error', feedbacks: [] },
    onLoadReasons: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const body = await reasonsOpen(canvasElement)
    await expect(await body.findByRole('alert')).toHaveTextContent('載入失敗')
    await userEvent.click(body.getByRole('button', { name: '重試' }))
    await expect(args.onLoadReasons).toHaveBeenCalledTimes(2)
  },
}

/**
 * Not in Penpot. A parent that gives no `onLoadReasons` and no `reasons`: nothing will load, so
 * the list says there is nothing rather than 載入中… for good.
 */
export const ReasonsWithoutLoader: Story = {
  tags: ['not-in-penpot'],
  play: async ({ canvasElement }) => {
    const body = await reasonsOpen(canvasElement)
    await waitFor(async () =>
      expect(await body.findByText('還沒有人留下有幫助的理由。')).toBeVisible(),
    )
    await expect(body.queryByText('載入中…')).toBeNull()
  },
}

/** Not in Penpot. Fetching failed and the parent can't fetch again: no 重試. */
export const ReasonsErrorWithoutRetry: Story = {
  tags: ['not-in-penpot'],
  args: { reasons: { status: 'error', feedbacks: [] } },
  play: async ({ canvasElement }) => {
    const body = await reasonsOpen(canvasElement)
    await expect(await body.findByRole('alert')).toHaveTextContent('載入失敗')
    await expect(body.queryByRole('button', { name: '重試' })).toBeNull()
  },
}

/** Not in Penpot. Nobody left a reason for this vote. */
export const ReasonsEmpty: Story = {
  tags: ['not-in-penpot'],
  args: { reasons: { status: 'success', feedbacks: [] } },
  play: async ({ canvasElement }) => {
    const body = await reasonsOpen(canvasElement)
    await waitFor(async () =>
      expect(await body.findByText('還沒有人留下有幫助的理由。')).toBeVisible(),
    )
  },
}
