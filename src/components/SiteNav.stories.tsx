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
 * While the mobile menu is open, focus cycles between the close button and the menu items; the
 * page under the menu is inert, so Tab never lands on content the menu covers.
 */
export const MobileMenuTrapsFocus: Story = {
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
    const menu = canvas.getByRole('button', { name: '開啟選單' })
    await userEvent.click(menu)
    const close = canvas.getByRole('button', { name: '關閉選單' })
    await expect(main).toHaveAttribute('inert')

    // Tab through the whole cycle twice; focus never leaves the close button + menu items.
    const items = within(
      canvas.getByRole('navigation', { name: '主選單' }),
    ).getAllByRole('link').length
    const seen: Array<Element | null> = []
    for (let i = 0; i < 2 * (items + 4); i++) {
      await userEvent.tab()
      seen.push(doc.activeElement)
    }
    await expect(seen).not.toContain(
      canvas.getByRole('link', { name: 'Content under the menu' }),
    )
    await expect(seen).toContain(close)
    // After the last item, Tab wraps to the close button; Shift+Tab from it wraps back.
    close.focus()
    await userEvent.tab({ shift: true })
    const last = doc.activeElement as HTMLElement
    await expect(
      canvas.getByRole('navigation', { name: '主選單' }),
    ).toContainElement(last)
    await userEvent.tab()
    await expect(close).toHaveFocus()

    // Esc closes the menu, returns focus to its button and un-inerts the page.
    await userEvent.keyboard('{Escape}')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toHaveFocus()
    await expect(main).not.toHaveAttribute('inert')
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
