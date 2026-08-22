import { UserAvatar } from './UserAvatar'
import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'components/UserAvatar',
  component: UserAvatar,
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
        body: 'Standing',
        face: 'Smile',
        hair: 'ShortHairDreads01',
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
