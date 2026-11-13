import { expect, fn, userEvent, within } from 'storybook/test'

import { SubmitReplyDialog } from './SubmitReplyDialog'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/SubmitReplyDialog',
  component: SubmitReplyDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    userName: 'Jack5566',
    onConfirm: fn(),
  },
} satisfies Meta<typeof SubmitReplyDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 確定送出 stays disabled until both boxes are checked. */
export const Default: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    const confirm = await body.findByRole('button', { name: '確定送出' })
    await expect(confirm).toBeDisabled()
    await userEvent.click(body.getByText('我已經檢查過回應內文與出處'))
    await expect(confirm).toBeDisabled()
    await userEvent.click(body.getByText(/我願意用「Jack5566」的身份/))
    await expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await expect(args.onConfirm).toHaveBeenCalled()
  },
}

export const Cancel: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: '取消' }))
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
    await expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** GetUser failed, so only the JWT is known: no display name. */
export const UnknownName: Story = { args: { userName: null } }

export const Sending: Story = { args: { pending: true } }

export const Failed: Story = {
  args: { error: 'cofacts-api responded 502' },
}
