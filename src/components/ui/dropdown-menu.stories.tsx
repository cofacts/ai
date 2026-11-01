import { expect, within } from 'storybook/test'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { UserAvatar } from '@/components/UserAvatar'

const meta = {
  title: 'ui/Dropdown menu',
  component: DropdownMenu,
  tags: ['not-in-penpot'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "**Not in Penpot.** shadcn's DropdownMenu (Base UI Menu) with Cofacts tokens: a menu of actions, unlike Select, which picks a value. The app uses it for the avatar menu in the nav. To discuss with the designer: keep it as is, match it to the Select popup, or add it to Penpot.",
      },
    },
  },
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

const user = {
  name: '苗',
  avatarUrl: 'https://www.gravatar.com/avatar/?d=identicon',
  avatarType: 'Gravatar' as const,
  avatarData: null,
}

/** The nav's avatar menu. The play function opens it. */
export const AvatarMenu: Story = {
  render: () => (
    <div className="flex min-h-[200px] items-start justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="苗 的帳號選單"
              className="rounded-full"
            />
          }
        >
          <UserAvatar user={user} size={40} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[224px]">
          <div className="flex items-center gap-spacing-12 px-spacing-12 py-spacing-8">
            <UserAvatar user={user} size={40} />
            <span className="min-w-0 flex-1 truncate text-type-ui-m text-text-primary">
              {user.name}
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem>登出</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '苗 的帳號選單' }))
    await expect(
      await within(document.body).findByRole('menuitem', { name: '登出' }),
    ).toBeVisible()
  },
}
