import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { FactCheckReply } from './FactCheckReply'
import type { FactCheckReplyProps } from './FactCheckReply'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-06T12:00:00+08:00')

/** Penpot's sample copy. */
const longText =
  '假的。目前沒有研究可以證實，雨水會傳播武漢病毒的案例。病毒是很難透過長期無宿主的戶外環境下生存的，通常在戶外，空氣的傳送或是雲雨的傳送，並非單一平面的移動，還是有垂直上下的運動，以每公里高度降低5-6度來看，近期對岸遇上冷高壓，地面已經近乎個位數字或零度以下，幾公里上層的空氣溫度更低，病毒在這樣的環境下難以存活。\n\n此外，雨滴在形成與降落的過程中會經過稀釋，即使空氣中有少量病毒，落到地面的濃度也極低，不足以造成感染。防疫仍應以勤洗手、戴口罩、保持社交距離為主。'

/**
 * The parent owns the vote state in the app, so the story plays the parent: pressing a vote
 * shows it, pressing it again takes it back. `onVote` is still called for the Actions panel.
 */
function Interactive(args: FactCheckReplyProps) {
  const [ownVote, setOwnVote] = useState(args.feedback.ownVote)
  return (
    <FactCheckReply
      {...args}
      feedback={{ ...args.feedback, ownVote }}
      onVote={(vote) => {
        args.onVote?.(vote)
        setOwnVote(vote === 'NEUTRAL' ? null : vote)
      }}
    />
  )
}

const meta = {
  title: 'components/FactCheckReply',
  component: FactCheckReply,
  parameters: {
    layout: 'fullscreen',
    penpot: {
      component: 'Content/FactCheckReply',
      mobile: 'Content/ReplyCard-Mobile',
    },
    viewport: { options: viewportOptions },
  },
  decorators: [
    (Story) => (
      // A page column: 16px gutters on mobile (Penpot's 343 in 375), 1040 max on desktop.
      <div className="mx-auto max-w-[1072px] p-spacing-16">
        <Story />
      </div>
    ),
  ],
  render: (args) => <Interactive {...args} />,
  args: {
    variant: 'default',
    replyType: 'RUMOR',
    author: {
      name: 'Jack5566',
      avatarUrl: 'https://www.gravatar.com/avatar/?d=identicon&s=136',
      avatarType: 'Gravatar',
      avatarData: null,
      level: 11,
    },
    text: longText,
    // Fixed, so 「1 天前」 doesn't change with the day the story is opened.
    createdAt: new Date(NOW - DAY - 60_000).toISOString(),
    now: new Date(NOW).toISOString(),
    citationCount: 2,
    feedback: { positiveCount: 100, negativeCount: 100, ownVote: null },
    onVote: fn(),
    onShowReasons: fn(),
    onShare: fn(),
    onReport: fn(),
  },
} satisfies Meta<typeof FactCheckReply>

export default meta
type Story = StoryObj<typeof meta>

// ── Penpot Type = default, with each FactCheckReply-Title ──

/**
 * Penpot Type = default, Title Incorrect. Click 閱讀全文 to open the whole text; the button
 * becomes 收合全文.
 */
export const Incorrect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const open = canvas.getByRole('button', { name: '閱讀全文' })
    await expect(open).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(open)
    const close = canvas.getByRole('button', { name: '收合全文' })
    await expect(close).toHaveAttribute('aria-expanded', 'true')
    const text = document.getElementById(close.getAttribute('aria-controls')!)!
    await expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight + 1)
    await userEvent.click(close)
    await expect(canvas.getByRole('button', { name: '閱讀全文' })).toHaveFocus()
  },
}

export const Correct: Story = { args: { replyType: 'NOT_RUMOR' } }

export const PersonalOpinion: Story = {
  args: { replyType: 'OPINIONATED' },
}

export const NotVerifiable: Story = { args: { replyType: 'NOT_ARTICLE' } }

// ── Penpot Type = with-link ──

/** Penpot Type = with-link: 資料佐證, a LinkCard, and 分享 / 檢舉 on desktop. */
export const WithLink: Story = {
  args: {
    variant: 'with-link',
    reference:
      'https://www.kaineng.com.tw/knowledge-bedridden-care/\nhttps://today.line.me/TW/article/v9qjD0?utm_source=lineshare',
    hyperlinks: [
      {
        url: 'https://today.line.me/TW/article/v9qjD0?utm_source=lineshare',
        title: '憂心防疫前線人員口罩！88歲嬤「1行為」曝光　6百萬人全落淚',
        summary:
          '新冠肺炎疫情在全球延燒，其中歐洲的義大利、西班牙淪為疫情重災區，死亡人數皆已超過中國。而在西班牙的一位年邁長者，不捨國家內的前線防疫人員將面臨口罩不足的情況，決定親手縫製口罩送給醫護人員，她的舉動感動了六百萬名網友。',
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('資料佐證')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: '檢舉' }))
    await expect(args.onReport).toHaveBeenCalled()
  },
}

// ── Not in Penpot ──

/** A text that fits needs no 閱讀全文. */
export const ShortText: Story = {
  args: { text: '假的。目前沒有研究可以證實雨水會傳播病毒。' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: '閱讀全文' }),
    ).toBeNull()
  },
}
