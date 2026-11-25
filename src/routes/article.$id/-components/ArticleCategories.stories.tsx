import { expect, fn, within } from 'storybook/test'

import { ArticleCategories } from './ArticleCategories'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'article/ArticleCategories',
  component: ArticleCategories,
  parameters: {
    penpot: { component: 'Feedback/Category' },
    docs: {
      description: {
        component:
          '訊息分類 on /article/:id (Penpot Feedback/Category). Not in Penpot: the strike-through on a category more people disagree with.',
      },
    },
  },
  args: {
    categories: [
      {
        categoryId: 'c1',
        title: '保健秘訣、食品安全',
        positiveFeedbackCount: 3,
        negativeFeedbackCount: 0,
      },
      {
        categoryId: 'c2',
        title: '政治、政黨',
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 2,
      },
    ],
    onSuggest: fn(),
  },
} satisfies Meta<typeof ArticleCategories>

export default meta
type Story = StoryObj<typeof meta>

/** A category more people disagree with is struck through and says so to screen readers. */
export const Default: Story = {
  play: async ({ canvasElement, args, userEvent }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: '訊息分類' })
    const items = within(list).getAllByRole('listitem')
    await expect(items[0]).toHaveTextContent('保健秘訣、食品安全')
    await expect(items[1]).toHaveTextContent('政治、政黨（多數人不同意）')
    await userEvent.click(canvas.getByRole('button', { name: '分類建議' }))
    await expect(args.onSuggest).toHaveBeenCalled()
  },
}

/** Penpot has no empty state: a message without categories shows only the button. */
export const Empty: Story = {
  args: { categories: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('list')).toBeNull()
    await expect(canvas.getByRole('button', { name: '分類建議' })).toBeVisible()
  },
}
