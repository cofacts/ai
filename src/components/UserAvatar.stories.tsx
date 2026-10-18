import { UserAvatar } from './UserAvatar'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/UserAvatar',
  component: UserAvatar,
  parameters: { penpot: { component: 'Base/Avatar' } },
} satisfies Meta<typeof UserAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Gravatar: Story = {
  args: {
    user: {
      name: '苗',
      avatarUrl: 'https://www.gravatar.com/avatar/?d=identicon',
      avatarType: 'Gravatar',
      avatarData: null,
    },
  },
}

export const OpenPeeps: Story = {
  args: {
    user: {
      name: 'Cofacts Peep',
      avatarUrl: null,
      avatarType: 'OpenPeeps',
      avatarData: JSON.stringify({
        accessory: 'None',
        body: 'Shirt',
        face: 'Smile',
        hair: 'ShortCurly',
        facialHair: 'None',
        backgroundColorIndex: 0.3,
        flip: false,
      }),
    },
  },
}

export const Large: Story = {
  args: {
    ...Gravatar.args,
    size: 96,
  },
}

/** Penpot Type = default (with level) and Certification-level. */
export const WithLevel: Story = {
  args: { ...Gravatar.args, size: 68, level: 99 },
}

export const Certified: Story = {
  args: { ...Gravatar.args, size: 68, level: 11, certified: true },
}
