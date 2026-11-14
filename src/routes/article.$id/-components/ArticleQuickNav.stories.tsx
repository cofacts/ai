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

/** Penpot Device = Desktop: a column of anchor links. */
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: '本頁索引' })
    const links = within(nav).getAllByRole('link')
    await expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#replies',
      '#similar',
      '#original',
    ])
    await expect(links[0]).toHaveAccessibleName('查核回應 (3)')
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

/** 「查核闢謠」 is outside the link row, so it isn't one of the 本頁索引 entries. */
export const WithCheckButton: Story = {
  args: { checkHref: '/article/example/reply/new' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: '本頁索引' })
    const button = canvas.getByRole('link', { name: '查核闢謠' })
    await expect(nav).not.toContainElement(button)
    await expect(button).toHaveAttribute('href', '/article/example/reply/new')
  },
}

/** Penpot Device = Mobile: the row scrolls sideways; 查核闢謠 floats at the bottom. */
export const Mobile: Story = {
  ...WithCheckButton,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
