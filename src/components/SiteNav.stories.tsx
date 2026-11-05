import { expect, fn, userEvent, within } from 'storybook/test'

import { SiteNav } from './SiteNav'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const user = {
  name: 'Jack5566',
  avatarUrl: 'https://www.gravatar.com/avatar/?d=identicon',
  avatarType: 'Gravatar',
  avatarData: null,
} as const

const meta = {
  title: 'components/SiteNav',
  component: SiteNav,
  parameters: { layout: 'fullscreen', penpot: { component: 'Layout/Nav' } },
  args: { user: null, current: 'replies', onLogin: fn(), onLogout: fn() },
} satisfies Meta<typeof SiteNav>

export default meta
type Story = StoryObj<typeof meta>

/** Penpot Type = Default. */
export const LoggedOut: Story = {}

/** Penpot Type = login, with the 99+ badge on 最新查核. */
export const LoggedIn: Story = { args: { user, newReplyCount: 120 } }

export const Loading: Story = { args: { user: undefined } }

/** Penpot Nav-Mobile Default. */
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

/** Penpot Nav-MobileExpanded: the hamburger opens the dark menu, Esc closes it. */
export const MobileMenuOpen: Story = {
  ...Mobile,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '開啟選單' }))
    await expect(
      canvas.getByRole('button', { name: '關閉選單' }),
    ).toHaveAttribute('aria-expanded', 'true')
  },
}

/**
 * While the mobile menu is open, nothing else can take focus: the page under it, the logo and
 * the search button are inert, so Tab only reaches the close button and the menu items.
 */
export const MobileMenuMakesRestInert: Story = {
  ...Mobile,
  render: (args) => (
    <>
      <SiteNav {...args} />
      <main className="p-spacing-20">
        <a href="#after-nav">Content under the menu</a>
      </main>
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const doc = canvasElement.ownerDocument
    const main = canvas.getByRole('main')
    const logo = canvas.getByRole('link', { name: 'Cofacts 真的假的 首頁' })
    const search = canvas.getByRole('button', { name: '搜尋' })
    const menu = canvas.getByRole('button', { name: '開啟選單' })
    await userEvent.click(menu)
    const close = canvas.getByRole('button', { name: '關閉選單' })
    const nav = canvas.getByRole('navigation', { name: '主選單' })
    await expect(main).toHaveAttribute('inert')
    await expect(logo).toHaveAttribute('inert')
    await expect(search).toHaveAttribute('inert')

    // Tab around twice: focus only ever lands on the close button or a menu item.
    const links = within(nav).getAllByRole('link').length
    for (let i = 0; i < 2 * (links + 4); i++) {
      await userEvent.tab()
      const active = doc.activeElement
      await expect(active === close || nav.contains(active)).toBe(true)
    }

    // Esc closes the menu, returns focus to its button and makes everything interactive again.
    await userEvent.keyboard('{Escape}')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toHaveFocus()
    await expect(main).not.toHaveAttribute('inert')
    await expect(logo).not.toHaveAttribute('inert')
    await expect(search).not.toHaveAttribute('inert')
  },
}

/** Penpot Type = search. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '搜尋' }),
    )
  },
}
