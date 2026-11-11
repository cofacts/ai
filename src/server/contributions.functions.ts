// Server functions for the 我的貢獻 page (/contributions): what the logged-in user has
// contributed to Cofacts, and what they could do next. The page loads them in the browser, each
// block on its own, so one failing query doesn't take the others down:
//
// - getContributionSummary (`contributionSummaryQuery`): level, points, totals, 「有幫助」 votes
//   received, and the daily counts behind the running-total chart.
// - getContributionTimeline (`contributionTimelineQuery`, infinite): the user's reports, replies
//   and ratings, newest first. rumors-api has no combined list, so each page fetches the next
//   items of the three `selfOnly` lists and merges them here (`loadTimelinePage`).
// - getContributionTasks (`contributionTasksQuery`) and getMoreRateTasks: candidates for the
//   task cards (rate a reply, write one). The page keeps a pool and asks for more rating
//   candidates as the user rates.
// - voteOnReply: a rating from a task card.
//
// Each read returns null when there is no usable session (no cookie, a JWT that doesn't verify,
// or rumors-api rejecting it: `GetUser` is then null). Failures from rumors-api are logged, since
// Cloud Run has no other trace of them, and rethrown so the block shows its error state.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import { graphql } from './gql'
import { verifySessionToken } from './jwt'
import { SESSION_COOKIE_NAME } from './sessionCookie'
import type { ReplyType } from '@/components/icons/StatusIcon'
import type {
  ContributionEntry,
  ContributionSummaryData,
  ContributionTasksData,
  FeedbackVoteValue,
  RateTask,
  TimelineCursor,
  TimelineEdge,
  TimelinePage,
  WriteTask,
} from '@/lib/contributions'
import { cofactsExec } from '@/server/cofacts.server'
import { replyTypes } from '@/components/icons/StatusIcon'
import {
  TIMELINE_PAGE_SIZE,
  buildCumulativeSeries,
  initialTimelineCursor,
  loadTimelinePage,
  parseTimelineCursor,
  seriesStart,
  sortRateTasks,
} from '@/lib/contributions'

/** Text is cut here before it is sent to the browser; cards show 2–3 lines. */
const SNIPPET = 140
/** The user's latest reports checked for replies to rate. */
const OWN_REPORTS = 10
/** Rating candidates fetched per `toRate` page. */
const RATE_PAGE = 12
/**
 * Writing candidates sent to the page. Rating candidates aren't capped: the page shows only the
 * first few and keeps the rest (`rateAfter` continues after the last one) for when the user rates.
 */
const WRITE_POOL = 4

const ContributionSummaryDocument = graphql(`
  query GetContributionSummary($since: String!, $userId: String!) {
    GetUser {
      id
      level
      points {
        total
        currentLevel
        nextLevel
      }
      contributions(dateRange: { GTE: $since }) {
        date
        count
      }
    }
    myReports: ListReplyRequests(filter: { selfOnly: true }) {
      totalCount
    }
    myReplies: ListReplies(filter: { selfOnly: true }) {
      totalCount
    }
    myFeedbacks: ListArticleReplyFeedbacks(filter: { selfOnly: true }) {
      totalCount
    }
    upvotesReceived: ListArticleReplyFeedbacks(
      filter: { authorId: $userId, vote: [UPVOTE] }
    ) {
      totalCount
    }
  }
`)

const ContributionTimelineDocument = graphql(`
  query GetContributionTimeline(
    $first: Int!
    $reportsAfter: String
    $repliesAfter: String
    $feedbacksAfter: String
    $withReports: Boolean!
    $withReplies: Boolean!
    $withFeedbacks: Boolean!
  ) {
    GetUser {
      id
    }
    myReports: ListReplyRequests(
      filter: { selfOnly: true }
      orderBy: [{ createdAt: DESC }]
      first: $first
      after: $reportsAfter
    ) @include(if: $withReports) {
      edges {
        cursor
        node {
          id
          reason
          createdAt
          article {
            id
            text
            articleType
            replyCount
          }
        }
      }
    }
    myReplies: ListReplies(
      filter: { selfOnly: true }
      orderBy: [{ createdAt: DESC }]
      first: $first
      after: $repliesAfter
    ) @include(if: $withReplies) {
      edges {
        cursor
        node {
          id
          text
          type
          createdAt
          articleReplies(status: NORMAL) {
            articleId
            positiveFeedbackCount
          }
        }
      }
    }
    myFeedbacks: ListArticleReplyFeedbacks(
      filter: { selfOnly: true }
      orderBy: [{ createdAt: DESC }]
      first: $first
      after: $feedbacksAfter
    ) @include(if: $withFeedbacks) {
      edges {
        cursor
        node {
          id
          vote
          createdAt
          article {
            id
            text
            articleType
          }
        }
      }
    }
  }
`)

// Messages with replies that need ratings, which the user didn't reply to themselves.
graphql(`
  fragment RateCandidates on ArticleConnection {
    edges {
      cursor
      node {
        id
        text
        articleType
        replyRequests {
          userId
        }
        articleReplies(status: NORMAL) {
          replyId
          userId
          ownVote
          feedbackCount
          replyType
          reply {
            text
          }
        }
      }
    }
  }
`)

const ContributionTasksDocument = graphql(`
  query GetContributionTasks(
    $userId: String!
    $ownReports: Int!
    $rateFirst: Int!
  ) {
    GetUser {
      id
    }
    myReports: ListReplyRequests(
      filter: { selfOnly: true }
      orderBy: [{ createdAt: DESC }]
      first: $ownReports
    ) {
      edges {
        node {
          article {
            id
            text
            articleType
            articleReplies(status: NORMAL) {
              replyId
              userId
              ownVote
              feedbackCount
              replyType
              reply {
                text
              }
            }
          }
        }
      }
    }
    toRate: ListArticles(
      filter: {
        articleTypes: [TEXT]
        replyCount: { GTE: 1 }
        hasArticleReplyWithMorePositiveFeedback: false
        articleRepliesFrom: { userId: $userId, exists: false }
      }
      orderBy: [{ lastRequestedAt: DESC }]
      first: $rateFirst
    ) {
      ...RateCandidates
    }
    toWrite: ListArticles(
      filter: {
        articleTypes: [TEXT]
        replyCount: { EQ: 0 }
        replyRequestCount: { GTE: 2 }
      }
      orderBy: [{ lastRequestedAt: DESC }]
      first: 6
    ) {
      edges {
        node {
          id
          text
          replyRequestCount
          replyRequests {
            userId
          }
        }
      }
    }
  }
`)

const MoreRateTasksDocument = graphql(`
  query GetMoreRateTasks($userId: String!, $rateFirst: Int!, $after: String!) {
    GetUser {
      id
    }
    toRate: ListArticles(
      filter: {
        articleTypes: [TEXT]
        replyCount: { GTE: 1 }
        hasArticleReplyWithMorePositiveFeedback: false
        articleRepliesFrom: { userId: $userId, exists: false }
      }
      orderBy: [{ lastRequestedAt: DESC }]
      first: $rateFirst
      after: $after
    ) {
      ...RateCandidates
    }
  }
`)

const VoteOnReplyDocument = graphql(`
  mutation VoteOnReply(
    $articleId: String!
    $replyId: String!
    $vote: FeedbackVote!
  ) {
    CreateOrUpdateArticleReplyFeedback(
      articleId: $articleId
      replyId: $replyId
      vote: $vote
    ) {
      replyId
      ownVote
    }
  }
`)

/** The session's user id, or null when there is no session or its JWT doesn't verify. */
async function sessionUserId(): Promise<string | null> {
  const token = getCookie(SESSION_COOKIE_NAME)
  if (!token) return null
  try {
    return (await verifySessionToken(token)).userId
  } catch {
    return null
  }
}

/** `cofactsExec`, logging a failure with rumors-api's message before rethrowing it. */
async function exec<TResult, TVariables>(
  operation: string,
  ...args: Parameters<typeof cofactsExec<TResult, TVariables>>
): Promise<TResult> {
  try {
    return await cofactsExec(...args)
  } catch (err) {
    console.error(`[contributions] ${operation} failed:`, err)
    throw err
  }
}

function snippet(text: string | null | undefined, articleType?: string | null) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    if (articleType === 'IMAGE') return '（圖片訊息）'
    if (articleType === 'VIDEO') return '（影片訊息）'
    if (articleType === 'AUDIO') return '（語音訊息）'
    return '（沒有文字內容）'
  }
  return trimmed.length > SNIPPET ? `${trimmed.slice(0, SNIPPET)}…` : trimmed
}

function asReplyType(type: string | null | undefined): ReplyType | null {
  return (replyTypes as ReadonlyArray<string>).includes(type ?? '')
    ? (type as ReplyType)
    : null
}

// --- node → ContributionEntry ----------------------------------------------------------------

function reportEntry(node: {
  id: string
  reason?: string | null
  createdAt?: string | null
  article: {
    id: string
    text?: string | null
    articleType?: string | null
    replyCount: number
  }
}): ContributionEntry | null {
  if (!node.createdAt) return null
  return {
    kind: 'report',
    id: node.id,
    createdAt: node.createdAt,
    articleId: node.article.id,
    articleText: snippet(node.article.text, node.article.articleType),
    reason: node.reason?.trim() ? snippet(node.reason) : '',
    replyCount: node.article.replyCount,
  }
}

function replyEntry(node: {
  id: string
  text?: string | null
  type?: string | null
  createdAt?: string | null
  articleReplies: ReadonlyArray<{
    articleId?: string | null
    positiveFeedbackCount: number
  }>
}): ContributionEntry | null {
  const replyType = asReplyType(node.type)
  if (!node.createdAt || !replyType) return null
  return {
    kind: 'reply',
    id: node.id,
    createdAt: node.createdAt,
    articleId: node.articleReplies[0]?.articleId ?? null,
    replyText: snippet(node.text),
    replyType,
    upvotes: node.articleReplies.reduce(
      (sum, ar) => sum + ar.positiveFeedbackCount,
      0,
    ),
  }
}

function feedbackEntry(node: {
  id: string
  vote?: string | null
  createdAt?: string | null
  article?: {
    id: string
    text?: string | null
    articleType?: string | null
  } | null
}): ContributionEntry | null {
  const { vote, createdAt, article } = node
  if (!createdAt || !article || (vote !== 'UPVOTE' && vote !== 'DOWNVOTE'))
    return null
  return {
    kind: 'feedback',
    id: node.id,
    createdAt,
    articleId: article.id,
    articleText: snippet(article.text, article.articleType),
    vote,
  }
}

// --- task candidates -------------------------------------------------------------------------

type ArticleReplyLike = {
  replyId: string | null
  userId: string | null
  ownVote: string | null
  feedbackCount: number | null
  replyType: string | null
  reply: { text: string | null } | null
}

/** A reply on `article` the user hasn't written or rated yet, the one with the fewest ratings. */
function pickReplyToRate(
  articleReplies: ReadonlyArray<ArticleReplyLike | null> | null | undefined,
  userId: string,
) {
  return (articleReplies ?? [])
    .filter(
      (ar): ar is ArticleReplyLike & { replyId: string } =>
        !!ar?.replyId &&
        ar.userId !== userId &&
        !ar.ownVote &&
        !!asReplyType(ar.replyType),
    )
    .sort((a, b) => (a.feedbackCount ?? 0) - (b.feedbackCount ?? 0))[0]
}

/** Whether `userId` reported (asked about) the message these reply requests belong to. */
function reportedByUser(
  replyRequests:
    | ReadonlyArray<{ userId: string | null } | null>
    | null
    | undefined,
  userId: string,
) {
  return (replyRequests ?? []).some((rr) => rr?.userId === userId)
}

/** A rating card for `article`, or null when it has no reply the user could rate. */
function rateTask(
  article: {
    id: string
    text?: string | null
    articleType?: string | null
    articleReplies?: ReadonlyArray<ArticleReplyLike | null> | null
  },
  reason: RateTask['reason'],
  userId: string,
): RateTask | null {
  const toRate = pickReplyToRate(article.articleReplies, userId)
  if (!toRate?.reply) return null
  return {
    kind: 'rate',
    reason,
    articleId: article.id,
    articleText: snippet(article.text, article.articleType),
    replyId: toRate.replyId,
    replyText: snippet(toRate.reply.text),
    replyType: asReplyType(toRate.replyType)!,
    feedbackCount: toRate.feedbackCount ?? 0,
  }
}

type RateCandidateEdges =
  | ReadonlyArray<{
      cursor: string
      node: Parameters<typeof rateTask>[0] & {
        replyRequests?: ReadonlyArray<{ userId: string | null } | null> | null
      }
    }>
  | null
  | undefined

/** Rating cards from a `toRate` page, and the cursor for the next page (null at the end). */
function rateCandidates(edges: RateCandidateEdges, userId: string) {
  const list = edges ?? []
  const rate = list.flatMap(({ node }) => {
    // An older report than the user's latest few: still the user's own message.
    const task = rateTask(
      node,
      reportedByUser(node.replyRequests, userId) ? 'reported' : 'needs-rating',
      userId,
    )
    return task ? [task] : []
  })
  return {
    rate,
    rateAfter: list.length < RATE_PAGE ? null : (list.at(-1)?.cursor ?? null),
  }
}

// --- server functions ------------------------------------------------------------------------

export const getContributionSummary = createServerFn({
  method: 'GET',
}).handler(async (): Promise<ContributionSummaryData | null> => {
  const userId = await sessionUserId()
  if (!userId) return null

  const now = new Date()
  const result = await exec(
    'GetContributionSummary',
    ContributionSummaryDocument,
    { since: seriesStart(now), userId },
  )
  const user = result.GetUser
  // rumors-api rejected the session: cofactsExec cleared the cookie and ran anonymously.
  if (!user) return null

  const totals = {
    reports: result.myReports?.totalCount ?? 0,
    replies: result.myReplies?.totalCount ?? 0,
    feedbacks: result.myFeedbacks?.totalCount ?? 0,
  }
  return {
    user: {
      level: user.level,
      points: {
        total: user.points.total,
        currentLevel: user.points.currentLevel,
        nextLevel: user.points.nextLevel,
      },
    },
    totals,
    upvotesReceived: result.upvotesReceived?.totalCount ?? 0,
    series: buildCumulativeSeries(
      (user.contributions ?? []).flatMap((c) =>
        c?.date ? [{ date: c.date, count: c.count ?? 0 }] : [],
      ),
      totals.reports + totals.replies + totals.feedbacks,
      now,
    ),
  }
})

export const getContributionTimeline = createServerFn({ method: 'GET' })
  .inputValidator((input: { cursor: TimelineCursor | null }) => ({
    cursor: parseTimelineCursor(
      (input as { cursor?: unknown } | null | undefined)?.cursor,
    ),
  }))
  .handler(async ({ data }): Promise<TimelinePage | null> => {
    const userId = await sessionUserId()
    if (!userId) return null

    const edges = <TNode extends { createdAt?: string | null }>(
      list: ReadonlyArray<{ cursor: string; node: TNode }> | null | undefined,
      toEntry: (node: TNode) => ContributionEntry | null,
    ): Array<TimelineEdge> =>
      (list ?? []).map((edge) => ({
        cursor: edge.cursor,
        createdAt: edge.node.createdAt ?? null,
        entry: toEntry(edge.node),
      }))

    // Set from inside the fetch callback (a later round can find the session rejected).
    const session = { rejected: false }
    const page = await loadTimelinePage(
      data.cursor ?? initialTimelineCursor(),
      async (cursor) => {
        const result = await exec(
          'GetContributionTimeline',
          ContributionTimelineDocument,
          {
            first: TIMELINE_PAGE_SIZE,
            reportsAfter: cursor.reports.after,
            repliesAfter: cursor.replies.after,
            feedbacksAfter: cursor.feedbacks.after,
            withReports: !cursor.reports.done,
            withReplies: !cursor.replies.done,
            withFeedbacks: !cursor.feedbacks.done,
          },
        )
        if (!result.GetUser) {
          session.rejected = true
          // Every list "done": no further round is fetched.
          return {}
        }
        return {
          reports: edges(result.myReports?.edges, reportEntry),
          replies: edges(result.myReplies?.edges, replyEntry),
          feedbacks: edges(result.myFeedbacks?.edges, feedbackEntry),
        }
      },
    )
    return session.rejected ? null : page
  })

export const getContributionTasks = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ContributionTasksData | null> => {
    const userId = await sessionUserId()
    if (!userId) return null

    const result = await exec(
      'GetContributionTasks',
      ContributionTasksDocument,
      { userId, ownReports: OWN_REPORTS, rateFirst: RATE_PAGE },
    )
    if (!result.GetUser) return null

    // Someone replied to a message the user reported: the most personal thing to rate.
    const own = (result.myReports?.edges ?? []).flatMap(({ node }) => {
      const task = rateTask(node.article, 'reported', userId)
      return task ? [task] : []
    })
    const more = rateCandidates(result.toRate?.edges, userId)

    const seen = new Set<string>()
    const rate = sortRateTasks(
      [...own, ...more.rate].filter((task) => {
        if (seen.has(task.articleId)) return false
        seen.add(task.articleId)
        return true
      }),
    )

    // Whoever submits a message also has a reply request on it, so this also skips messages the
    // user submitted: they are already in the timeline, and the user is waiting for an answer.
    const write: Array<WriteTask> = (result.toWrite?.edges ?? [])
      .filter(
        ({ node }) =>
          !reportedByUser(node.replyRequests, userId) && !seen.has(node.id),
      )
      .slice(0, WRITE_POOL)
      .map(({ node }) => ({
        kind: 'write',
        articleId: node.id,
        articleText: snippet(node.text),
        replyRequestCount: node.replyRequestCount ?? 0,
      }))

    return { rate, write, rateAfter: more.rateAfter }
  },
)

export const getMoreRateTasks = createServerFn({ method: 'GET' })
  .inputValidator((input: { after: string }) => {
    const after = (input as { after?: unknown } | null | undefined)?.after
    if (typeof after !== 'string' || !after) {
      throw new Error('after is required')
    }
    return { after }
  })
  .handler(
    async ({
      data,
    }): Promise<Pick<ContributionTasksData, 'rate' | 'rateAfter'> | null> => {
      const userId = await sessionUserId()
      if (!userId) return null

      const result = await exec('GetMoreRateTasks', MoreRateTasksDocument, {
        userId,
        rateFirst: RATE_PAGE,
        after: data.after,
      })
      if (!result.GetUser) return null

      const { rate, rateAfter } = rateCandidates(result.toRate?.edges, userId)
      return { rate: sortRateTasks(rate), rateAfter }
    },
  )

// Per user: `clearUserScopedCache` removes all of these on logout.

export const contributionSummaryQuery = queryOptions({
  queryKey: ['GetContributionSummary'],
  queryFn: () => getContributionSummary(),
  staleTime: 60_000,
})

export const contributionTimelineQuery = infiniteQueryOptions({
  queryKey: ['GetContributionTimeline'],
  queryFn: ({ pageParam }) =>
    getContributionTimeline({ data: { cursor: pageParam } }),
  initialPageParam: null as TimelineCursor | null,
  getNextPageParam: (last) => last?.nextCursor ?? undefined,
  staleTime: 60_000,
  refetchOnWindowFocus: false,
})

/** Not refetched after a vote: the page keeps its own pool, so cards don't reshuffle. */
export const contributionTasksQuery = queryOptions({
  queryKey: ['GetContributionTasks'],
  queryFn: () => getContributionTasks(),
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  // Coming back to the page fetches a fresh pool (cards rated meanwhile are left out by
  // rumors-api) instead of showing a cached one with rated cards still votable.
  gcTime: 0,
})

export const moreRateTasksQuery = (after: string) =>
  queryOptions({
    queryKey: ['GetMoreRateTasks', { after }],
    queryFn: () => getMoreRateTasks({ data: { after } }),
    staleTime: 5 * 60_000,
  })

export const voteOnReply = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      articleId: string
      replyId: string
      vote: FeedbackVoteValue
    }) => {
      if (
        typeof input.articleId !== 'string' ||
        !input.articleId ||
        typeof input.replyId !== 'string' ||
        !input.replyId
      ) {
        throw new Error('articleId and replyId are required')
      }
      // A caller is not bound by the type at runtime: check the value rumors-api will store.
      if (
        !(['UPVOTE', 'DOWNVOTE'] as ReadonlyArray<string>).includes(input.vote)
      ) {
        throw new Error(`Unknown vote: ${String(input.vote)}`)
      }
      return input
    },
  )
  .handler(async ({ data }) => {
    try {
      const result = await cofactsExec(VoteOnReplyDocument, data)
      return {
        ownVote: result.CreateOrUpdateArticleReplyFeedback?.ownVote ?? null,
      }
    } catch (err) {
      console.error('[contributions] VoteOnReply failed:', err)
      throw err
    }
  })
