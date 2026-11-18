import { FactCheckReplyCard } from './FactCheckReplyCard'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/FactCheckReplyCard',
  component: FactCheckReplyCard,
  tags: ['not-in-penpot'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "**Not in Penpot.** One existing fact-check response: the verdict (`FactCheckReplyTitle`), the text, the sources the responder cited, and the feedback counts. The app uses it in the AI chat's article drawer (`RightDrawer`) and on the outcome screen of `/report`. Penpot has Content/FactCheckReply-Title but no card around it. To discuss with the designer: keep it as is, or add it to Penpot.",
      },
    },
  },
  args: {
    type: 'RUMOR',
    text: '中文維基百科中有以下關於倪海廈之資料：\n\n「倪海廈出身於政治系，且並無任何醫學或生物相關教育背景。」',
    reference: 'https://zh.wikipedia.org/zh-hant/倪海廈',
    authorName: 'woof!',
    helpfulCount: 12,
    unhelpfulCount: 1,
  },
  decorators: [
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FactCheckReplyCard>

export default meta
type Story = StoryObj<typeof meta>

export const Incorrect: Story = {}
export const Correct: Story = { args: { type: 'NOT_RUMOR' } }
export const PersonalOpinion: Story = { args: { type: 'OPINIONATED' } }
export const NotVerifiable: Story = { args: { type: 'NOT_ARTICLE' } }

/** No sources, no author: both are optional. */
export const Minimal: Story = {
  args: { reference: undefined, authorName: undefined },
}

/** A verdict rumors-api adds later still shows, as its raw value, instead of blank. */
export const UnknownVerdict: Story = { args: { type: 'SOMETHING_NEW' } }

/** A percent-encoded link must wrap instead of widening the page. */
export const LongLink: Story = {
  args: {
    reference:
      'https://zh.wikipedia.org/zh-hant/%E5%80%AA%E6%B5%B7%E5%BB%88#%E7%88%AD%E8%AD%B0%E8%88%87%E6%89%B9%E8%A9%95_%E9%95%B7%E9%95%B7%E9%95%B7',
  },
}
