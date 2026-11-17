import { expect, fn, waitFor, within } from 'storybook/test'

import { CategoryDialog } from './CategoryDialog'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'article/CategoryDialog',
  component: CategoryDialog,
  tags: ['not-in-penpot'],
  parameters: {
    docs: {
      description: {
        component:
          "**Not in Penpot as far as known** (not audited: no Penpot MCP when this was built). 「建議分類」 on /article/:id opens it: rumors-site's AddCategoryDialog, where one marks categories and agrees or disagrees with them. To discuss with the designer.",
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    categories: [
      {
        id: 'c-other',
        title: '有意義但不是闢謠的資訊',
        description: '不是謠言，但有參考價值的資訊。',
        marked: false,
        canUnmark: false,
      },
      {
        id: 'c-health',
        title: '保健秘訣、食品安全',
        description: '和健康、飲食相關的說法。',
        marked: true,
        canUnmark: false,
        ownVote: null,
        positiveFeedbackCount: 2,
        negativeFeedbackCount: 1,
      },
      {
        id: 'c-mine',
        title: '政治、政黨',
        marked: true,
        canUnmark: true,
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 0,
      },
    ],
    onMark: fn(),
    onUnmark: fn(),
    onAgree: fn(),
    onStartDisagree: fn(),
    onCancelDisagree: fn(),
    onDisagree: fn(),
  },
} satisfies Meta<typeof CategoryDialog>

export default meta
type Story = StoryObj<typeof meta>

async function findDialog() {
  // The dialog is portaled to <body>, outside the story's canvas.
  const dialog = await within(document.body).findByRole('dialog', {
    name: '為這則訊息分類',
  })
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}

/** Marked categories come first; each one's buttons are named by its list item. */
export const Default: Story = {
  play: async ({ args, userEvent }) => {
    const dialog = await findDialog()
    const [health, mine, other] = dialog
      .getAllByRole('listitem')
      .map((option) => within(option))
    await expect(
      [health, mine, other].map(
        (option) => option?.getByRole('heading').textContent,
      ),
    ).toEqual([
      '# 保健秘訣、食品安全',
      '# 政治、政黨',
      '# 有意義但不是闢謠的資訊',
    ])
    if (!health || !mine || !other) return

    await expect(health.getByText('66% 同意、33% 不同意')).toBeInTheDocument()
    await userEvent.click(health.getByRole('button', { name: '同意' }))
    await expect(args.onAgree).toHaveBeenCalledWith('c-health')

    // Marked by the current user: they may unmark it, not vote on it.
    await expect(mine.getByRole('button', { name: '同意' })).toBeDisabled()
    await userEvent.click(mine.getByRole('button', { name: '取消標記' }))
    await expect(args.onUnmark).toHaveBeenCalledWith('c-mine')

    await expect(other.queryByRole('button', { name: '同意' })).toBeNull()
    await userEvent.click(other.getByRole('button', { name: '標記' }))
    await expect(args.onMark).toHaveBeenCalledWith('c-other')
  },
}

/** The disagreement form shows why others disagreed, and asks why. */
export const Disagreeing: Story = {
  args: {
    disagreeingId: 'c-health',
    disagreements: [{ id: 'f1', comment: '這是政治新聞。', userName: '小明' }],
  },
  play: async ({ args, userEvent }) => {
    const dialog = await findDialog()
    await expect(dialog.getByText('這是政治新聞。')).toBeInTheDocument()
    const reason = dialog.getByLabelText(
      '為什麼這則訊息不屬於「保健秘訣、食品安全」？',
    )
    await userEvent.type(reason, '和健康無關')
    await userEvent.click(dialog.getByRole('button', { name: '送出不同意' }))
    await expect(args.onDisagree).toHaveBeenCalledWith('c-health', '和健康無關')
  },
}

export const Loading: Story = {
  args: { categories: undefined },
  play: async () => {
    const dialog = await findDialog()
    await expect(dialog.getByText('載入分類中…')).toBeInTheDocument()
  },
}

/** After a vote, the result is announced (role=status). */
export const Voted: Story = {
  args: { statusMessage: '感謝你的回饋。' },
  play: async () => {
    const dialog = await findDialog()
    await expect(dialog.getByRole('status')).toHaveTextContent('感謝你的回饋。')
  },
}
