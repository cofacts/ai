import { ReplyTypeLabel } from './ReplyTypeLabel'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/ReplyTypeLabel',
  component: ReplyTypeLabel,
  parameters: { penpot: { component: 'Content/FactCheckReply-Title' } },
  args: { type: 'RUMOR', author: 'Jack5566' },
} satisfies Meta<typeof ReplyTypeLabel>

export default meta
type Story = StoryObj<typeof meta>

export const Incorrect: Story = {}
export const Correct: Story = { args: { type: 'NOT_RUMOR' } }
export const PersonalOpinion: Story = {
  args: { type: 'OPINIONATED', author: 'woof!' },
}
export const NotVerifiable: Story = {
  args: { type: 'NOT_ARTICLE', author: 'Harris Elizabeth' },
}

export const All: Story = {
  render: () => (
    <div className="flex flex-col gap-spacing-24">
      <ReplyTypeLabel type="RUMOR" author="Jack5566" />
      <ReplyTypeLabel type="NOT_RUMOR" author="Jack5566" />
      <ReplyTypeLabel type="OPINIONATED" author="woof!" />
      <ReplyTypeLabel type="NOT_ARTICLE" author="Harris Elizabeth" />
    </div>
  ),
}
