import { useEffect } from 'react'
import { fn } from 'storybook/test'

import { ContributionFeed } from './ContributionFeed'
import { ContributionSummary } from './ContributionSummary'
import { CumulativeChart } from './CumulativeChart'
import { useTaskSlots } from './useTaskSlots'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type {
  ContributionEntry,
  ContributionSummaryData,
  ContributionTasksData,
  FeedbackVoteValue,
  RateTask,
} from '@/lib/contributions'
import { buildCumulativeSeries } from '@/lib/contributions'

const now = new Date('2026-11-11T12:00:00Z')

const sampleSummary: ContributionSummaryData = {
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
}

const sampleEntries: Array<ContributionEntry> = [
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
]

const [reported, write, needsRating] = [
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
] as const

const moreToRate: Array<RateTask> = [
  {
    kind: 'rate',
    reason: 'needs-rating',
    articleId: 'a9',
    articleText: '台電宣布下週全台分區停電，請大家提早準備',
    replyId: 'r9',
    replyText: '台電表示並無分區停電計畫，備轉容量率正常。',
    replyType: 'RUMOR',
    feedbackCount: 0,
  },
  {
    kind: 'rate',
    reason: 'needs-rating',
    articleId: 'a10',
    articleText: '健保卡明年起全面改用手機版，實體卡停用',
    replyId: 'r10',
    replyText: '健保署說明虛擬健保卡為輔助，實體健保卡仍可使用，沒有停用規劃。',
    replyType: 'RUMOR',
    feedbackCount: 2,
  },
  {
    kind: 'rate',
    reason: 'needs-rating',
    articleId: 'a11',
    articleText: '衛福部公告：每天喝一杯咖啡可降低失智風險',
    replyId: 'r11',
    replyText:
      '研究顯示適量咖啡與部分健康指標有關聯，但並非因果關係，衛福部也沒有發布此公告。',
    replyType: 'OPINIONATED',
    feedbackCount: 1,
  },
  {
    kind: 'rate',
    reason: 'needs-rating',
    articleId: 'a12',
    articleText: '國道明天起改收新的通行費，超過 200 公里加倍',
    replyId: 'r12',
    replyText: '高公局表示通行費率沒有調整，網傳訊息為舊聞拼湊。',
    replyType: 'RUMOR',
    feedbackCount: 0,
  },
  {
    kind: 'rate',
    reason: 'needs-rating',
    articleId: 'a13',
    articleText: '颱風天把冰箱插頭拔掉可以省電又安全',
    replyId: 'r13',
    replyText:
      '停電時拔插頭可避免復電時突波，但平時拔掉冰箱插頭會讓食物變質，並不建議。',
    replyType: 'OPINIONATED',
    feedbackCount: 1,
  },
]

const sampleTasks: ContributionTasksData = {
  rate: [reported, needsRating, ...moreToRate],
  write: [write],
  rateAfter: null,
}

/** Stories have no server: the pool is what `tasks` holds. */
const noMoreRateTasks = () => Promise.resolve(null)

/**
 * The /contributions page body, as the route lays it out once everything has loaded. Task slots
 * come from the route's `useTaskSlots`; `votes` are ratings given before the story starts.
 */
function ContributionsView({
  summary,
  entries,
  tasks,
  votes = [],
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onVote,
}: {
  summary: ContributionSummaryData
  entries: Array<ContributionEntry>
  tasks: ContributionTasksData
  votes?: Array<[articleId: string, vote: FeedbackVoteValue]>
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore: () => void
  onVote: (task: RateTask, vote: FeedbackVoteValue) => Promise<void>
}) {
  const { slots, voted, onVoted } = useTaskSlots(tasks, noMoreRateTasks)

  useEffect(() => {
    for (const [articleId, vote] of votes) {
      const task = tasks.rate.find((t) => t.articleId === articleId)
      if (task) onVoted(task, vote)
    }
    // Once, on mount.
  }, [])

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-spacing-24 px-spacing-20 py-spacing-32 lg:px-spacing-48">
      <ContributionSummary
        profile={{
          name: '查核貓',
          avatarUrl: 'https://www.gravatar.com/avatar/?d=identicon',
          avatarType: 'Gravatar',
          avatarData: null,
        }}
        user={summary.user}
        totals={summary.totals}
        upvotesReceived={summary.upvotesReceived}
      />
      <CumulativeChart series={summary.series} />
      <ContributionFeed
        entries={entries}
        slots={slots}
        voted={voted}
        onVote={async (task, vote) => {
          await onVote(task, vote)
          onVoted(task, vote)
        }}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={onLoadMore}
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
          '**Not in Penpot.** 我的貢獻 (`/contributions`, from the avatar menu): totals, a running-total chart, and the contribution timeline with task cards (rate a reply, write a reply) in between. A rated card collapses to one line and the next candidate appears under it. Modeled on the Google Maps contributions tab; needs a Penpot board.',
      },
    },
  },
  args: {
    summary: sampleSummary,
    entries: sampleEntries,
    tasks: sampleTasks,
    onLoadMore: fn(),
    onVote: fn(() => Promise.resolve()),
  },
} satisfies Meta<typeof ContributionsView>

export default meta
type Story = StoryObj<typeof meta>

/** Everything loaded; rate a card to see the next one appear under it. */
export const Default: Story = {}

/** A new user: no history yet, so only the task cards show. */
export const Empty: Story = {
  args: {
    summary: {
      user: { level: 0, points: { total: 0, currentLevel: 0, nextLevel: 1 } },
      totals: { reports: 0, replies: 0, feedbacks: 0 },
      upvotesReceived: 0,
      series: buildCumulativeSeries([], 0, now),
    },
    entries: [],
  },
}

/** Voting fails: the card says so and keeps the buttons. */
export const VoteFails: Story = {
  args: { onVote: fn(() => Promise.reject(new Error('network'))) },
}

/** Rated twice in a row: two collapsed lines, then the next card in the same place. */
export const RatedInARow: Story = {
  args: {
    votes: [
      [reported.articleId, 'UPVOTE'],
      [moreToRate[2]!.articleId, 'DOWNVOTE'],
    ],
  },
}

/** Rated the last candidate: the line says there is nothing else to rate for now. */
export const NothingLeftToRate: Story = {
  args: {
    tasks: { rate: [reported], write: [write], rateAfter: null },
    votes: [[reported.articleId, 'UPVOTE']],
  },
}

/** More history to load: the button at the end (it also loads on scroll in the app). */
export const HasMore: Story = {
  args: { hasMore: true },
}

/** Loading the next page. */
export const LoadingMore: Story = {
  args: { hasMore: true, isLoadingMore: true },
}
