/**
 * Shapes for the 我的貢獻 page (`/contributions`) and the pure functions that build them. The
 * server function (`src/server/contributions.functions.ts`) turns rumors-api results into these;
 * the page and its components only see these types.
 */

import type { ReplyType } from '@/components/icons/StatusIcon'

export type FeedbackVoteValue = 'UPVOTE' | 'DOWNVOTE'

/** One thing the user did, shown in the timeline. */
export type ContributionEntry =
  | {
      kind: 'report'
      id: string
      createdAt: string
      articleId: string
      articleText: string
      /** The reason the user gave when reporting; empty when none. */
      reason: string
      /** How many fact-check replies the reported message has now. */
      replyCount: number
    }
  | {
      kind: 'reply'
      id: string
      createdAt: string
      /** The first message this reply is attached to; null when it was removed from all. */
      articleId: string | null
      replyText: string
      replyType: ReplyType
      /** 「有幫助」 votes summed over every message this reply is attached to. */
      upvotes: number
    }
  | {
      kind: 'feedback'
      id: string
      createdAt: string
      articleId: string
      articleText: string
      vote: FeedbackVoteValue
    }

export type ContributionKind = ContributionEntry['kind']

/** Something the user can do next, shown between timeline entries. */
export type ContributionTask =
  | {
      /** Rate a reply: on a message the user reported (`reason: 'reported'`) or one that needs ratings. */
      kind: 'rate'
      reason: 'reported' | 'needs-rating'
      articleId: string
      articleText: string
      replyId: string
      replyText: string
      replyType: ReplyType
      /** Ratings the reply has so far. */
      feedbackCount: number
    }
  | {
      /** Write a reply for a message nobody has answered yet. */
      kind: 'write'
      articleId: string
      articleText: string
      replyRequestCount: number
    }

export interface CumulativePoint {
  /** Monday of the week, `yyyy-MM-dd` in Taiwan time. */
  weekStart: string
  /** All contributions up to the end of that week. */
  total: number
  /** Contributions made during that week. */
  added: number
}

export interface ContributionsData {
  user: {
    level: number
    points: { total: number; currentLevel: number; nextLevel: number | null }
  }
  totals: { reports: number; replies: number; feedbacks: number }
  /** 「有幫助」 votes other users gave the user's replies. */
  upvotesReceived: number
  series: Array<CumulativePoint>
  timeline: Array<ContributionEntry>
  tasks: Array<ContributionTask>
}

export const SERIES_WEEKS = 12

const DAY_MS = 24 * 60 * 60 * 1000
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

/** `yyyy-MM-dd` of `now` in Taiwan time (rumors-api buckets contributions in +08:00). */
export function taipeiDate(now: Date): string {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

/** Monday of the week that contains `date` (`yyyy-MM-dd`). */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(date, -((day + 6) % 7))
}

/** The first day the chart covers: Monday, `weeks - 1` weeks before this week's Monday. */
export function seriesStart(now: Date, weeks = SERIES_WEEKS): string {
  return addDays(mondayOf(taipeiDate(now)), -7 * (weeks - 1))
}

/**
 * Weekly running totals that only go up. `daily` are rumors-api's `User.contributions` buckets
 * from `seriesStart()` on; `total` is every contribution ever, so what came before the window is
 * `total - sum(daily)` (never below 0, since the two counts can disagree slightly: the daily
 * buckets also count hidden items).
 */
export function buildCumulativeSeries(
  daily: ReadonlyArray<{ date: string; count: number }>,
  total: number,
  now: Date,
  weeks = SERIES_WEEKS,
): Array<CumulativePoint> {
  const start = seriesStart(now, weeks)
  const perWeek = new Array<number>(weeks).fill(0)
  let inWindow = 0
  for (const { date, count } of daily) {
    const index = Math.floor(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        (7 * DAY_MS),
    )
    if (index < 0 || index >= weeks) continue
    perWeek[index] = (perWeek[index] ?? 0) + count
    inWindow += count
  }
  let running = Math.max(0, total - inWindow)
  return perWeek.map((count, i) => {
    running += count
    return { weekStart: addDays(start, 7 * i), total: running, added: count }
  })
}

/** Newest first, at most `limit`. */
export function mergeTimeline(
  lists: ReadonlyArray<ReadonlyArray<ContributionEntry>>,
  limit = 20,
): Array<ContributionEntry> {
  return lists
    .flat()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit)
}

export type FeedItem =
  | { type: 'entry'; entry: ContributionEntry }
  | { type: 'task'; task: ContributionTask }

/**
 * The timeline with tasks mixed in: the first task on top, then one after every `every` entries.
 * Tasks left over go at the end, so none is dropped.
 */
export function interleave(
  entries: ReadonlyArray<ContributionEntry>,
  tasks: ReadonlyArray<ContributionTask>,
  every = 3,
): Array<FeedItem> {
  const queue = [...tasks]
  const items: Array<FeedItem> = []
  const next = () => {
    const task = queue.shift()
    if (task) items.push({ type: 'task', task })
  }
  next()
  entries.forEach((entry, i) => {
    items.push({ type: 'entry', entry })
    if ((i + 1) % every === 0) next()
  })
  while (queue.length) next()
  return items
}

/** `key` used for a task in lists and after a vote. */
export function taskKey(task: ContributionTask): string {
  return task.kind === 'rate'
    ? `rate:${task.articleId}:${task.replyId}`
    : `write:${task.articleId}`
}
