import { fn } from 'storybook/test'

import { SuspiciousMessageCard } from './SuspiciousMessageCard'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/SuspiciousMessageCard',
  component: SuspiciousMessageCard,
  tags: ['not-in-penpot'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '**Not in Penpot.** A suspicious message at a glance: enough text to recognise it, and whether anyone has answered it. The app uses it in two forms: the whole card is a link in the "similar messages" carousel of the AI chat\'s article drawer (`RightDrawer`, `href`); on `/report` it is the candidate list, with 查看這則訊息 and 就是這則 as separate actions (`viewHref` + `onSelect`), because picking is a +1. To discuss with the designer: keep it as is, or add it to Penpot.',
      },
    },
  },
  args: {
    text: '工商時間\n我都回本了，你們還等什麼呢？\n第三次招收普通會員，免入會費，要跟我賺業外收入，信得過我，先註冊吧！只輸入電話驗證，姓名，設定密碼即可完成註冊。',
    articleType: 'TEXT',
    factCheckCount: 0,
  },
  decorators: [
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SuspiciousMessageCard>

export default meta
// Not `typeof meta`: the props are a union (`href` or `viewHref` + `onSelect`), and deriving the
// args from meta's partial args collapses that union to `never`.
type Story = StoryObj<typeof SuspiciousMessageCard>

/** Carousel form: the whole card links out. */
export const Link: Story = {
  args: { href: 'https://cofacts.tw/article/example', factCheckCount: 1 },
}

/** Candidate form, nobody has answered yet: picking sends a +1. */
export const CandidateUnanswered: Story = {
  args: {
    viewHref: 'https://cofacts.tw/article/example',
    onSelect: fn(),
    communityDemandCount: 2,
  },
}

export const CandidateAnswered: Story = {
  args: {
    viewHref: 'https://cofacts.tw/article/example',
    onSelect: fn(),
    factCheckCount: 1,
    communityDemandCount: 5,
  },
}

/** While the page is acting on a pick, so it can't be repeated. */
export const CandidateBusy: Story = {
  args: {
    viewHref: 'https://cofacts.tw/article/example',
    onSelect: fn(),
    disabled: true,
  },
}

/** A message with no text (an image, say) shows its type instead of blank. */
export const NoText: Story = {
  args: {
    text: null,
    articleType: 'IMAGE',
    viewHref: 'https://cofacts.tw/article/example',
    onSelect: fn(),
  },
}

/** A bare long link must wrap instead of widening the card. */
export const LongLink: Story = {
  args: {
    text: 'https://www.facebook.com/share/p/1HSNRpimmH1HSNRpimmH1HSNRpimmH1HSNRpimmH1HSNRpimmH/?mibextid=wwXIfr',
    viewHref: 'https://cofacts.tw/article/example',
    onSelect: fn(),
  },
}

/** Candidate form for a bare link: the scraped title is what tells candidates apart. */
export const CandidateLinkWithTitle: Story = {
  args: {
    text: 'https://x.com/atensnut/status/2120196706352390258?a=fC7jzydZO9v08-5ETgU&s=46影片',
    linkTitle: 'Juanita Broaddrick (@atensnut) on X',
    viewHref: 'https://cofacts.tw/article/example',
    onSelect: fn(),
    communityDemandCount: 1,
  },
}
