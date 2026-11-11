// Server functions for the 我的貢獻 page (/contributions): what the logged-in user has
// contributed to Cofacts, and what they could do next. The page reads it through
// `myContributionsQuery`; a vote from a task card goes through `voteOnReply`.
//
// Two rumors-api round trips, run in parallel:
// - GetMyContributions: the user's level and daily contribution counts, and their latest
//   reports (reply requests), replies and reply ratings, all via `selfOnly`.
// - GetContributionSuggestions: needs the user id (the session JWT's subject): ratings other
//   users gave the user's replies, messages with replies that need ratings, and messages
//   nobody has replied to yet.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { queryOptions } from '@tanstack/react-query'

import { graphql } from './gql'
import { verifySessionToken } from './jwt'
import { SESSION_COOKIE_NAME } from './sessionCookie'
import type { ReplyType } from '@/components/icons/StatusIcon'
import type {
  ContributionEntry,
  ContributionTask,
  ContributionsData,
  FeedbackVoteValue,
} from '@/lib/contributions'
import { cofactsExec } from '@/server/cofacts.server'
import { replyTypes } from '@/components/icons/StatusIcon'
import {
  buildCumulativeSeries,
  mergeTimeline,
  seriesStart,
} from '@/lib/contributions'

/** Items per list fetched for the timeline; the page shows the newest 20 of them merged. */
const LIST_SIZE = 10
/** Text is cut here before it is sent to the browser; cards show 2–3 lines. */
const SNIPPET = 140

const MyContributionsDocument = graphql(`
  query GetMyContributions($since: String!, $first: Int!) {
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
    myReports: ListReplyRequests(
      filter: { selfOnly: true }
      orderBy: [{ createdAt: DESC }]
      first: $first
    ) {
      totalCount
      edges {
        node {
          id
          reason
          createdAt
          article {
            id
            text
            articleType
            replyCount
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
    myReplies: ListReplies(
      filter: { selfOnly: true }
      orderBy: [{ createdAt: DESC }]
      first: $first
    ) {
      totalCount
      edges {
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
    ) {
      totalCount
      edges {
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

const ContributionSuggestionsDocument = graphql(`
  query GetContributionSuggestions($userId: String!) {
    upvotesReceived: ListArticleReplyFeedbacks(
      filter: { authorId: $userId, vote: [UPVOTE] }
    ) {
      totalCount
    }
    toRate: ListArticles(
      filter: {
        articleTypes: [TEXT]
        replyCount: { GTE: 1 }
        hasArticleReplyWithMorePositiveFeedback: false
        articleRepliesFrom: { userId: $userId, exists: false }
      }
      orderBy: [{ lastRequestedAt: DESC }]
      first: 6
    ) {
      edges {
        node {
          id
          text
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

export const getMyContributions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ContributionsData | null> => {
    const token = getCookie(SESSION_COOKIE_NAME)
    if (!token) return null

    let userId: string
    try {
      ;({ userId } = await verifySessionToken(token))
    } catch {
      return null
    }

    const now = new Date()
    const [mineResult, suggestionsResult] = await Promise.allSettled([
      cofactsExec(MyContributionsDocument, {
        since: seriesStart(now),
        first: LIST_SIZE,
      }),
      cofactsExec(ContributionSuggestionsDocument, { userId }),
    ])
    // Logged so a failure shows up in Cloud Run logs with rumors-api's message; the error
    // page itself only says the data couldn't be loaded.
    if (mineResult.status === 'rejected') {
      console.error(
        '[contributions] GetMyContributions failed:',
        mineResult.reason,
      )
      throw mineResult.reason
    }
    const mine = mineResult.value
    // Suggestions are extras: without them the page still shows the user's own contributions.
    if (suggestionsResult.status === 'rejected') {
      console.error(
        '[contributions] GetContributionSuggestions failed:',
        suggestionsResult.reason,
      )
    }
    const suggestions =
      suggestionsResult.status === 'fulfilled' ? suggestionsResult.value : null
    const user = mine.GetUser
    // rumors-api rejected the session: cofactsExec cleared the cookie and ran anonymously.
    if (!user) return null

    const reports: Array<ContributionEntry> = []
    const rateTasks: Array<ContributionTask> = []
    for (const edge of mine.myReports?.edges ?? []) {
      const { id, reason, createdAt, article } = edge.node
      if (!createdAt) continue
      reports.push({
        kind: 'report',
        id,
        createdAt,
        articleId: article.id,
        articleText: snippet(article.text, article.articleType),
        reason: reason?.trim() ? snippet(reason) : '',
        replyCount: article.replyCount,
      })
      // Someone replied to a message the user reported: the most personal thing to rate.
      const toRate = pickReplyToRate(article.articleReplies, user.id)
      if (toRate && toRate.reply) {
        rateTasks.push({
          kind: 'rate',
          reason: 'reported',
          articleId: article.id,
          articleText: snippet(article.text, article.articleType),
          replyId: toRate.replyId,
          replyText: snippet(toRate.reply.text),
          replyType: asReplyType(toRate.replyType)!,
          feedbackCount: toRate.feedbackCount ?? 0,
        })
      }
    }

    const replies: Array<ContributionEntry> = []
    for (const edge of mine.myReplies?.edges ?? []) {
      const { id, text, type, createdAt, articleReplies } = edge.node
      const replyType = asReplyType(type)
      if (!createdAt || !replyType) continue
      replies.push({
        kind: 'reply',
        id,
        createdAt,
        articleId: articleReplies[0]?.articleId ?? null,
        replyText: snippet(text),
        replyType,
        upvotes: articleReplies.reduce(
          (sum, ar) => sum + ar.positiveFeedbackCount,
          0,
        ),
      })
    }

    const feedbacks: Array<ContributionEntry> = []
    for (const edge of mine.myFeedbacks?.edges ?? []) {
      const { id, vote, createdAt, article } = edge.node
      if (!createdAt || !article || (vote !== 'UPVOTE' && vote !== 'DOWNVOTE'))
        continue
      feedbacks.push({
        kind: 'feedback',
        id,
        createdAt,
        articleId: article.id,
        articleText: snippet(article.text, article.articleType),
        vote,
      })
    }

    for (const edge of suggestions?.toRate?.edges ?? []) {
      const article = edge.node
      if (rateTasks.some((t) => t.articleId === article.id)) continue
      const toRate = pickReplyToRate(article.articleReplies, user.id)
      if (!toRate || !toRate.reply) continue
      rateTasks.push({
        kind: 'rate',
        // An older report than the timeline's latest few: still the user's own message.
        reason: reportedByUser(article.replyRequests, user.id)
          ? 'reported'
          : 'needs-rating',
        articleId: article.id,
        articleText: snippet(article.text),
        replyId: toRate.replyId,
        replyText: snippet(toRate.reply.text),
        replyType: asReplyType(toRate.replyType)!,
        feedbackCount: toRate.feedbackCount ?? 0,
      })
    }

    // Whoever submits a message also has a reply request on it, so this also skips messages the
    // user submitted: they are already in the timeline, and the user is waiting for an answer.
    const writeTasks: Array<ContributionTask> = (
      suggestions?.toWrite?.edges ?? []
    )
      .filter(({ node }) => !reportedByUser(node.replyRequests, user.id))
      .map(({ node }) => ({
        kind: 'write',
        articleId: node.id,
        articleText: snippet(node.text),
        replyRequestCount: node.replyRequestCount ?? 0,
      }))

    // Two rating cards for each writing card: rating is the easy first step (meeting notes:
    // 卡牌 vs 寫字), and replies on the user's own reports come first.
    const tasks: Array<ContributionTask> = []
    const rates = rateTasks.slice(0, 4)
    const writes = writeTasks.slice(0, 2)
    while (rates.length || writes.length) {
      tasks.push(...rates.splice(0, 2))
      tasks.push(...writes.splice(0, 1))
    }

    const totals = {
      reports: mine.myReports?.totalCount ?? 0,
      replies: mine.myReplies?.totalCount ?? 0,
      feedbacks: mine.myFeedbacks?.totalCount ?? 0,
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
      upvotesReceived: suggestions?.upvotesReceived?.totalCount ?? 0,
      series: buildCumulativeSeries(
        (user.contributions ?? []).flatMap((c) =>
          c?.date ? [{ date: c.date, count: c.count ?? 0 }] : [],
        ),
        totals.reports + totals.replies + totals.feedbacks,
        now,
      ),
      timeline: mergeTimeline([reports, replies, feedbacks]),
      tasks,
    }
  },
)

/** Per user: `clearUserScopedCache` removes it on logout. */
export const myContributionsQuery = queryOptions({
  queryKey: ['GetMyContributions'],
  queryFn: () => getMyContributions(),
  staleTime: 60_000,
})

export const voteOnReply = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      articleId: string
      replyId: string
      vote: FeedbackVoteValue
    }) => {
      if (!input.articleId || !input.replyId) {
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
    const result = await cofactsExec(VoteOnReplyDocument, data)
    return {
      ownVote: result.CreateOrUpdateArticleReplyFeedback?.ownVote ?? null,
    }
  })
