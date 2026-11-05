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

/** Tabbing out of the open menu closes it, so focus never lands on content the menu covers. */
export const MobileMenuClosesWhenFocusLeaves: Story = {
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
    const header = canvas.getByRole('banner')
    await userEvent.click(canvas.getByRole('button', { name: '開啟選單' }))
    await expect(
      canvas.getByRole('button', { name: '關閉選單' }),
    ).toHaveAttribute('aria-expanded', 'true')
    // Stay inside the header for a few tabs: the menu stays open.
    await userEvent.tab()
    await expect(header).toContainElement(
      canvasElement.ownerDocument.activeElement as HTMLElement,
    )
    await expect(
      canvas.getByRole('button', { name: '關閉選單' }),
    ).toHaveAttribute('aria-expanded', 'true')
    // Tab on until focus leaves the header.
    for (
      let i = 0;
      i < 20 && header.contains(canvasElement.ownerDocument.activeElement);
      i++
    )
      await userEvent.tab()
    await expect(
      canvas.getByRole('link', { name: 'Content under the menu' }),
    ).toHaveFocus()
    await expect(
      canvas.getByRole('button', { name: '開啟選單' }),
    ).toHaveAttribute('aria-expanded', 'false')
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
