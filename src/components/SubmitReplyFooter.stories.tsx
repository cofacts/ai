import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SubmitReplyFooter } from './SubmitReplyFooter'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/SubmitReplyFooter',
  component: SubmitReplyFooter,
  decorators: [
    (Story) => (
      <div className="max-w-[480px]">
        <Story />
      </div>
    ),
  ],
  args: {
    userName: 'Jack5566',
    checked: false,
    onCheckedChange: fn(),
    problem: null,
    onSubmit: fn(),
  },
  // Keep the checkbox state in the story, as FactCheckDraftPanel does.
  render: function Render(args) {
    const [checked, setChecked] = useState(args.checked)
    return (
      <SubmitReplyFooter
        {...args}
        checked={checked}
        onCheckedChange={(next) => {
          setChecked(next)
          args.onCheckedChange(next)
        }}
      />
    )
  },
} satisfies Meta<typeof SubmitReplyFooter>

export default meta
type Story = StoryObj<typeof meta>

/** The button names the account and stays disabled until the box is checked. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const submit = canvas.getByRole('button', {
      name: /用.Jack5566.的身份送出查核回應/,
    })
    await expect(submit).toBeDisabled()
    await userEvent.click(canvas.getByText('我已經檢查過回應內文與出處'))
    await expect(submit).toBeEnabled()
    await userEvent.click(submit)
    await expect(args.onSubmit).toHaveBeenCalledTimes(1)
  },
}

/** GetUser failed, so only the JWT is known: no display name. */
export const UnknownName: Story = {
  args: { userName: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: '用你的帳號送出查核回應' }),
    ).toBeVisible()
  },
}

/**
 * A long name is cut with an ellipsis so the label stays inside the button at phone width (a
 * 320px screen minus the drawer's padding). The accessible name keeps the full name.
 */
export const LongName: Story = {
  args: { userName: '一個非常非常非常長的使用者暱稱' },
  decorators: [
    (Story) => (
      <div className="w-[288px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', {
      name: /用.一個非常非常非常長的使用者暱稱.的身份送出查核回應/,
    })
    await userEvent.click(canvas.getByText('我已經檢查過回應內文與出處'))
    const label = button.querySelector('span.flex')
    await expect(label).not.toBeNull()
    // Nothing spills out of the button.
    await expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
    await expect(label!.getBoundingClientRect().right).toBeLessThanOrEqual(
      button.getBoundingClientRect().right,
    )
  },
}

/** No Cofacts article (or an empty field): the reason replaces the check. */
export const CannotSubmit: Story = {
  args: {
    problem:
      '這段對話沒有對應的 Cofacts 訊息，無法直接送出。請從 Cofacts 的訊息頁開始查核。',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('checkbox')).toBeNull()
    await expect(
      canvas.getByRole('button', { name: /送出查核回應/ }),
    ).toBeDisabled()
  },
}

export const Sending: Story = {
  args: { checked: true, pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: '送出中…' })).toBeDisabled()
    await expect(canvas.getByRole('checkbox')).toBeDisabled()
  },
}

export const Failed: Story = {
  args: { checked: true, error: 'cofacts-api responded 502' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('502')
    await expect(
      canvas.getByRole('button', { name: /送出查核回應/ }),
    ).toBeEnabled()
  },
}

/** The user already replied to this article: a link to it, and a plain outline button. */
export const AlreadyReplied: Story = {
  args: {
    existingReplies: [{ articleId: 'article-1', replyId: 'reply-1' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('link', { name: '查看你的回應' }),
    ).toHaveAttribute('href', 'https://cofacts.tw/reply/reply-1')
    const submit = canvas.getByRole('button', {
      name: /以.Jack5566.的身份再次送出新回應/,
    })
    await expect(submit).toBeDisabled()
    await userEvent.click(canvas.getByText('我已經檢查過回應內文與出處'))
    await expect(submit).toBeEnabled()
  },
}
