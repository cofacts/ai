import { expect, within } from 'storybook/test'

import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Dialog',
  component: Dialog,
  tags: ['not-in-penpot'],
  parameters: {
    docs: {
      description: {
        component:
          "**Not in Penpot.** shadcn's Dialog with Cofacts tokens. The app uses it for the login modal (`LoginModal`). To discuss with the designer: keep it as is, or add a dialog to Penpot.",
      },
    },
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

/** The play function opens the dialog. */
export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button>登入</Button>} />
      <DialogContent>
        <DialogTitle>登入 Cofacts</DialogTitle>
        <DialogDescription>登入後即可開始使用 Cofacts.ai。</DialogDescription>
        <DialogClose render={<Button variant="outline">取消</Button>} />
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '登入' }))
    // The dialog is portaled to <body>, outside the story's canvas.
    await expect(
      await within(document.body).findByRole('dialog', {
        name: '登入 Cofacts',
      }),
    ).toBeVisible()
  },
}
