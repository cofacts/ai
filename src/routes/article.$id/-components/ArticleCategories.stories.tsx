import { expect, fn, within } from 'storybook/test'

import { ArticleCategories } from './ArticleCategories'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'article/ArticleCategories',
  component: ArticleCategories,
  tags: ['not-in-penpot'],
  parameters: {
    // Penpot Feedback/Category; not audited yet (no Penpot MCP when this was built).
    penpot: { component: 'Feedback/Category' },
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
    const items = canvas.getAllByRole('listitem')
    await expect(items[0]).toHaveTextContent('保健秘訣、食品安全')
    await expect(items[1]).toHaveTextContent('政治、政黨（多數人不同意）')
    await userEvent.click(canvas.getByRole('button', { name: '建議分類' }))
    await expect(args.onSuggest).toHaveBeenCalled()
  },
}

export const Empty: Story = {
  args: { categories: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('還沒有分類。'),
    ).toBeInTheDocument()
  },
}
