import { fn } from 'storybook/test'

import { ContributionFeed } from './ContributionFeed'
import { ContributionSummary } from './ContributionSummary'
import { CumulativeChart } from './CumulativeChart'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { ContributionsData } from '@/lib/contributions'
import { buildCumulativeSeries } from '@/lib/contributions'

const now = new Date('2026-11-11T12:00:00Z')

const sample: ContributionsData = {
  user: {
    level: 5,
    points: { total: 1240, currentLevel: 1000, nextLevel: 1500 },
  },
  totals: { reports: 23, replies: 12, feedbacks: 87 },
  upvotesReceived: 156,
  series: buildCumulativeSeries(
    [
      { date: '2026-08-25', count: 3 },
      { date: '2026-09-03', count: 5 },
      { date: '2026-09-21', count: 8 },
      { date: '2026-10-02', count: 4 },
      { date: '2026-10-14', count: 11 },
      { date: '2026-10-29', count: 7 },
      { date: '2026-11-10', count: 6 },
    ],
    122,
    now,
  ),
  timeline: [
    {
      kind: 'reply',
      id: 'r1',
      createdAt: '2026-11-09T10:00:00Z',
      articleId: 'a1',
      replyText:
        '喝熱檸檬水可以殺死癌細胞的說法缺乏科學根據，體外實驗的結果不能直接推論到人體。',
      replyType: 'RUMOR',
      upvotes: 12,
    },
    {
      kind: 'report',
      id: 'q1',
      createdAt: '2026-11-08T02:00:00Z',
      articleId: 'a2',
      articleText: '颱風假今天晚上會宣布，人事行政總處內部消息，先轉給家人…',
      reason: '家族群組收到，想知道是不是真的',
      replyCount: 0,
    },
    {
      kind: 'feedback',
      id: 'f1',
      createdAt: '2026-11-07T02:00:00Z',
      articleId: 'a3',
      articleText: '疫苗含有追蹤晶片，打了之後手機會自動連線…',
      vote: 'UPVOTE',
    },
    {
      kind: 'report',
      id: 'q2',
      createdAt: '2026-10-25T02:00:00Z',
      articleId: 'a4',
      articleText: '高雄某國小發生集體食物中毒，學校隱瞞不報',
      reason: '',
      replyCount: 2,
    },
    {
      kind: 'feedback',
      id: 'f2',
      createdAt: '2026-10-20T02:00:00Z',
      articleId: 'a5',
      articleText: '勞保年金明年破產，現在不領就領不到',
      vote: 'DOWNVOTE',
    },
  ],
  tasks: [
    {
      kind: 'rate',
      reason: 'reported',
      articleId: 'a6',
      articleText: '明天起 LINE 要收費，轉發這則給 10 個人就可以免費使用…',
      replyId: 'r6',
      replyText: 'LINE 官方未發布任何收費公告，此類訊息自 2015 年起反覆流傳。',
      replyType: 'RUMOR',
      feedbackCount: 0,
    },
    {
      kind: 'write',
      articleId: 'a7',
      articleText: '醫師提醒：吃香蕉配優格會產生毒素，已有多人送醫…',
      replyRequestCount: 9,
    },
    {
      kind: 'rate',
      reason: 'needs-rating',
      articleId: 'a8',
      articleText: '中選會宣布明年起改用電子投票',
      replyId: 'r8',
      replyText: '中選會澄清並無此規劃，現行法規規定以紙本選票投票。',
      replyType: 'RUMOR',
      feedbackCount: 1,
    },
  ],
}

/** The /contributions page body, as the route lays it out. */
function ContributionsView({
  data,
  onVote,
}: {
  data: ContributionsData
  onVote: () => Promise<void>
}) {
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-spacing-24 px-spacing-20 py-spacing-32 lg:px-spacing-48">
      <ContributionSummary
        profile={{
          name: '查核貓',
          avatarUrl: 'https://www.gravatar.com/avatar/?d=identicon',
          avatarType: 'Gravatar',
          avatarData: null,
        }}
        user={data.user}
        totals={data.totals}
        upvotesReceived={data.upvotesReceived}
      />
      <CumulativeChart series={data.series} />
      <ContributionFeed
        entries={data.timeline}
        tasks={data.tasks}
        onVote={onVote}
      />
    </main>
  )
}

const meta = {
  title: 'pages/Contributions',
  component: ContributionsView,
  tags: ['not-in-penpot'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          '**Not in Penpot.** 我的貢獻 (`/contributions`, from the avatar menu): totals, a running-total chart, and the contribution timeline with task cards (rate a reply, write a reply) in between. Modeled on the Google Maps contributions tab; needs a Penpot board.',
      },
    },
  },
  args: { data: sample, onVote: fn(() => Promise.resolve()) },
} satisfies Meta<typeof ContributionsView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A new user: no history yet, so only the task cards show. */
export const Empty: Story = {
  args: {
    data: {
      ...sample,
      user: { level: 0, points: { total: 0, currentLevel: 0, nextLevel: 1 } },
      totals: { reports: 0, replies: 0, feedbacks: 0 },
      upvotesReceived: 0,
      series: buildCumulativeSeries([], 0, now),
      timeline: [],
    },
  },
}

/** Voting fails: the card says so and keeps the buttons. */
export const VoteFails: Story = {
  args: { onVote: fn(() => Promise.reject(new Error('network'))) },
}
