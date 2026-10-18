import { expect, fn, userEvent, within } from 'storybook/test'

import { AiNav, SiteNav } from './SiteNav'
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

/** Penpot Type = search. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '搜尋' }),
    )
  },
}

/** Penpot Type = AI: the Cofacts AI header. */
export const Ai: StoryObj<typeof AiNav> = {
  render: (args) => <AiNav {...args} />,
  args: { user, onLogin: fn(), onLogout: fn(), onToggleSidebar: fn() },
}
