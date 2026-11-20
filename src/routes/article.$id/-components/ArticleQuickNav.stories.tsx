import { expect, within } from 'storybook/test'

import { getQuickNavItems } from '../-lib'
import { ArticleQuickNav } from './ArticleQuickNav'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'article/ArticleQuickNav',
  component: ArticleQuickNav,
  parameters: { penpot: { component: 'Layout/ActionPanel' } },
  args: { items: getQuickNavItems({ replyCount: 3 }) },
} satisfies Meta<typeof ArticleQuickNav>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Penpot Device = Desktop: a column of anchor links under 「快速索引」.
 * 相似可疑訊息與組合 is left out: on desktop it sits in the right column.
 */
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: '快速索引' }),
    ).toBeVisible()
    const nav = canvas.getByRole('navigation', { name: '本頁索引' })
    const links = within(nav).getAllByRole('link')
    await expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#original',
      '#replies',
    ])
    await expect(links[0]).toHaveAccessibleName('原始訊息')
    await expect(links[1]).toHaveAccessibleName('查核回應 (3)')
  },
}

/** No reply yet: AI 自動分析 takes the place after 查核回應. */
export const NoReply: Story = {
  args: { items: getQuickNavItems({ replyCount: 0 }) },
  play: async ({ canvasElement }) => {
    const nav = within(canvasElement).getByRole('navigation', {
      name: '本頁索引',
    })
    await expect(
      within(nav).getByRole('link', { name: 'AI 自動分析' }),
    ).toHaveAttribute('href', '#ai-analysis')
  },
}

/** 「我要查核闢謠」 is outside the link row, so it isn't one of the 本頁索引 entries. */
export const WithCheckButton: Story = {
  args: { checkHref: '/article/example/reply/new' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: '本頁索引' })
    const button = canvas.getByRole('link', { name: '我要查核闢謠' })
    await expect(nav).not.toContainElement(button)
    await expect(button).toHaveAttribute('href', '/article/example/reply/new')
  },
}

/**
 * Penpot Device = Mobile: the row scrolls sideways, with no heading and with
 * 相似可疑訊息與組合; 我要查核闢謠 floats at the bottom.
 */
export const Mobile: Story = {
  ...WithCheckButton,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async (context) => {
    await WithCheckButton.play?.(context)
    const canvas = within(context.canvasElement)
    await expect(
      canvas.queryByRole('heading', { name: '快速索引' }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: '相似可疑訊息與組合' }),
    ).toBeVisible()
  },
}
