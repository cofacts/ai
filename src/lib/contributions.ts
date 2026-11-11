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

/** Top of the page: level, totals and the running-total chart. */
export interface ContributionSummaryData {
  user: {
    level: number
    points: { total: number; currentLevel: number; nextLevel: number | null }
  }
  totals: { reports: number; replies: number; feedbacks: number }
  /** 「有幫助」 votes other users gave the user's replies. */
  upvotesReceived: number
  series: Array<CumulativePoint>
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

// ---------------------------------------------------------------------------------------------
// Timeline: one newest-first list merged from three rumors-api lists, page by page.

/** Where one rumors-api list stands: the edge cursor to continue after, and whether it ran out. */
export interface ListCursor {
  after: string | null
  done: boolean
}

/** Where each of the timeline's three lists stands; the page param of the infinite query. */
export interface TimelineCursor {
  reports: ListCursor
  replies: ListCursor
  feedbacks: ListCursor
}

export type TimelineList = keyof TimelineCursor

export const TIMELINE_LISTS: ReadonlyArray<TimelineList> = [
  'reports',
  'replies',
  'feedbacks',
]

/** Entries per timeline page; also how many items are fetched from each list per page. */
export const TIMELINE_PAGE_SIZE = 20

export const initialTimelineCursor = (): TimelineCursor => ({
  reports: { after: null, done: false },
  replies: { after: null, done: false },
  feedbacks: { after: null, done: false },
})

/**
 * One edge as rumors-api returned it, newest first. `createdAt` is the item's own date, used for
 * merging even when the page can't show the item; `entry` is null for such an item (a neutral
 * rating, a removed message, an unknown reply type). It is still consumed, so the cursor moves
 * past it.
 */
export interface TimelineEdge {
  cursor: string
  createdAt: string | null
  entry: ContributionEntry | null
}

export interface TimelinePage {
  entries: Array<ContributionEntry>
  /** null when all three lists ran out. */
  nextCursor: TimelineCursor | null
}

/**
 * Merges what each unfinished list returned (up to `pageSize` edges each, fetched after
 * `cursor`) into the next page, newest first.
 *
 * The merge runs on raw edges, shown or not: it takes the newest `pageSize` edges of all lists,
 * moves each list's cursor past the last edge taken from it, then drops the edges the page can't
 * show. Every item of the next `pageSize` overall is among the next `pageSize` of its own list,
 * so across pages entries come out newest first, none skipped or repeated. An edge without a
 * date is placed after the dated edges of its batch, so it never reorders them. A page may hold
 * fewer than `pageSize` entries, or none, when edges it took can't be shown; `loadTimelinePage`
 * fetches again in that case. A list is done when it returned fewer than `pageSize` edges and
 * all of them were taken.
 */
export function mergeTimelinePage(
  cursor: TimelineCursor,
  fetched: Partial<Record<TimelineList, ReadonlyArray<TimelineEdge>>>,
  pageSize = TIMELINE_PAGE_SIZE,
): TimelinePage {
  const edgesOf = (list: TimelineList) =>
    cursor[list].done ? [] : (fetched[list] ?? [])

  const raw = TIMELINE_LISTS.flatMap((list) => {
    const edges = edgesOf(list)
    const times = edges.map((e) => Date.parse(e.createdAt ?? ''))
    const dated = times.filter((t) => !Number.isNaN(t))
    // Undated: as old as the oldest dated edge of the batch, and placed after it.
    const oldest = dated.length ? Math.min(...dated) : Infinity
    return edges.map((edge, index) => {
      const undated = Number.isNaN(times[index])
      return {
        list,
        index,
        edge,
        undated,
        time: undated ? oldest : times[index]!,
      }
    })
  })
  // Newest first. Ties: lists in order; within a list, dated edges before undated ones, then
  // edge order.
  raw.sort((a, b) => {
    if (a.time !== b.time) return a.time > b.time ? -1 : 1
    return (
      TIMELINE_LISTS.indexOf(a.list) - TIMELINE_LISTS.indexOf(b.list) ||
      Number(a.undated) - Number(b.undated) ||
      a.index - b.index
    )
  })
  const taken = raw.slice(0, pageSize)

  const next = {} as TimelineCursor
  for (const list of TIMELINE_LISTS) {
    if (cursor[list].done) {
      next[list] = cursor[list]
      continue
    }
    const edges = edgesOf(list)
    const takenHere = taken.filter((t) => t.list === list)
    // Dated edges are taken in order, so only undated ones can be passed over: they are dropped.
    const lastIndex = Math.max(-1, ...takenHere.map((t) => t.index))
    next[list] = {
      after: lastIndex >= 0 ? edges[lastIndex]!.cursor : cursor[list].after,
      done: edges.length < pageSize && takenHere.length === edges.length,
    }
  }

  return {
    entries: taken.flatMap((t) => (t.edge.entry ? [t.edge.entry] : [])),
    nextCursor: TIMELINE_LISTS.every((list) => next[list].done) ? null : next,
  }
}

/**
 * Fetches and merges the timeline page after `cursor`. When every edge a page took was one the
 * page can't show, it fetches again from where that left off (up to `maxRounds` fetches), so
 * the browser rarely gets an empty page that still says there is more.
 */
export async function loadTimelinePage(
  cursor: TimelineCursor,
  fetchLists: (
    cursor: TimelineCursor,
  ) => Promise<Partial<Record<TimelineList, ReadonlyArray<TimelineEdge>>>>,
  pageSize = TIMELINE_PAGE_SIZE,
  maxRounds = 3,
): Promise<TimelinePage> {
  let page = mergeTimelinePage(cursor, await fetchLists(cursor), pageSize)
  for (
    let round = 1;
    round < maxRounds && page.entries.length === 0 && page.nextCursor;
    round++
  ) {
    const from: TimelineCursor = page.nextCursor
    page = mergeTimelinePage(from, await fetchLists(from), pageSize)
  }
  return page
}

function isListCursor(value: unknown): value is ListCursor {
  if (typeof value !== 'object' || value === null) return false
  const { after, done } = value as Record<string, unknown>
  return (
    (after === null || typeof after === 'string') && typeof done === 'boolean'
  )
}

/** Checks a timeline page param from the browser; throws when it isn't one. */
export function parseTimelineCursor(input: unknown): TimelineCursor | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'object') throw new Error('Invalid timeline cursor')
  const record = input as Record<string, unknown>
  const cursor = {} as TimelineCursor
  for (const list of TIMELINE_LISTS) {
    const value = record[list]
    if (!isListCursor(value))
      throw new Error(`Invalid timeline cursor: ${list}`)
    cursor[list] = { after: value.after, done: value.done }
  }
  return cursor
}

// ---------------------------------------------------------------------------------------------
// Task cards: a pool of candidates, laid out in slots between timeline entries.

export type RateTask = Extract<ContributionTask, { kind: 'rate' }>
export type WriteTask = Extract<ContributionTask, { kind: 'write' }>

export interface ContributionTasksData {
  /** Rating candidates, replies on the user's own reports first. */
  rate: Array<RateTask>
  write: Array<WriteTask>
  /** Edge cursor to fetch more rating candidates after; null when there are no more. */
  rateAfter: string | null
}

/** `key` used for a task in lists and after a vote. */
export function taskKey(task: ContributionTask): string {
  return task.kind === 'rate'
    ? `rate:${task.articleId}:${task.replyId}`
    : `write:${task.articleId}`
}

/** Replies on messages the user reported first, then the rest; order kept within each group. */
export function sortRateTasks(tasks: ReadonlyArray<RateTask>): Array<RateTask> {
  return [
    ...tasks.filter((t) => t.reason === 'reported'),
    ...tasks.filter((t) => t.reason !== 'reported'),
  ]
}

/** `pool` followed by the tasks of `incoming` on messages not already in it. */
export function mergeRatePool(
  pool: ReadonlyArray<RateTask>,
  incoming: ReadonlyArray<RateTask>,
): Array<RateTask> {
  const articles = new Set(pool.map((t) => t.articleId))
  const merged = [...pool]
  for (const task of incoming) {
    if (articles.has(task.articleId)) continue
    articles.add(task.articleId)
    merged.push(task)
  }
  return merged
}

/**
 * The first layout of task cards: slots in the order R R W R R W …, from the first `rates`
 * rating and `writes` writing candidates (two ratings per writing card: rating is the easy first
 * step). A slot is a list of task keys; it starts with one and grows as the user rates.
 */
export function composeTaskSlots(
  tasks: Pick<ContributionTasksData, 'rate' | 'write'>,
  rates = 4,
  writes = 2,
): Array<Array<string>> {
  const r = tasks.rate.slice(0, rates)
  const w = tasks.write.slice(0, writes)
  const slots: Array<Array<string>> = []
  while (r.length || w.length) {
    for (const task of r.splice(0, 2)) slots.push([taskKey(task)])
    for (const task of w.splice(0, 1)) slots.push([taskKey(task)])
  }
  return slots
}

/** What happened after the user rated a task card. */
export interface VotedTask {
  vote: FeedbackVoteValue
  /** A new card was added under it / there are no candidates left / still looking. */
  next: 'added' | 'exhausted' | 'pending'
}

/** Task-card state on the page; only the page changes it, so cards never move on their own. */
export interface TaskSlotsState {
  rate: Array<RateTask>
  write: Array<WriteTask>
  rateAfter: string | null
  slots: Array<Array<string>>
  voted: Record<string, VotedTask>
  /** Voted keys still waiting for a new card, oldest first. */
  waiting: Array<string>
}

export function initTaskSlots(tasks: ContributionTasksData): TaskSlotsState {
  return {
    rate: tasks.rate,
    write: tasks.write,
    rateAfter: tasks.rateAfter,
    slots: composeTaskSlots(tasks),
    voted: {},
    waiting: [],
  }
}

function shownKeys(state: TaskSlotsState) {
  return new Set(state.slots.flat())
}

/** Rating candidates in the pool that no slot shows yet. */
export function unshownRateTasks(state: TaskSlotsState): Array<RateTask> {
  const shown = shownKeys(state)
  return state.rate.filter((t) => !shown.has(taskKey(t)))
}

/** Gives waiting voted cards a new card under them, while candidates last. */
function fillWaiting(state: TaskSlotsState): TaskSlotsState {
  if (!state.waiting.length) return state
  const candidates = unshownRateTasks(state)
  const slots = state.slots.map((slot) => [...slot])
  const voted = { ...state.voted }
  const waiting: Array<string> = []
  for (const key of state.waiting) {
    const slot = slots.find((s) => s.includes(key))
    if (!slot || !voted[key]) continue
    const candidate = candidates.shift()
    if (candidate) {
      slot.splice(slot.indexOf(key) + 1, 0, taskKey(candidate))
      voted[key] = { ...voted[key], next: 'added' }
    } else if (state.rateAfter === null) {
      voted[key] = { ...voted[key], next: 'exhausted' }
    } else {
      waiting.push(key)
    }
  }
  return { ...state, slots, voted, waiting }
}

/** The user rated card `key`: record it, and put the next candidate directly under it. */
export function recordVote(
  state: TaskSlotsState,
  key: string,
  vote: FeedbackVoteValue,
): TaskSlotsState {
  if (state.voted[key]) return state
  return fillWaiting({
    ...state,
    voted: { ...state.voted, [key]: { vote, next: 'pending' } },
    waiting: [...state.waiting, key],
  })
}

/**
 * More rating candidates arrived (fetched after `from`). Ignored when the pool moved on since
 * (`from` is no longer the cursor), so a late response can't add stale candidates.
 */
export function addRateTasks(
  state: TaskSlotsState,
  from: string,
  more: { rate: ReadonlyArray<RateTask>; rateAfter: string | null },
): TaskSlotsState {
  if (state.rateAfter !== from) return state
  return fillWaiting({
    ...state,
    rate: mergeRatePool(state.rate, more.rate),
    rateAfter: more.rateAfter,
  })
}

/**
 * The tasks query returned new data (a refetch): keep everything the user sees and the pool
 * gathered so far (including pages fetched after the first), and only add new candidates from
 * the refetch. Cards never move or disappear.
 */
export function syncTaskSlots(
  state: TaskSlotsState,
  tasks: ContributionTasksData,
): TaskSlotsState {
  const writeArticles = new Set(state.write.map((t) => t.articleId))
  return fillWaiting({
    ...state,
    rate: mergeRatePool(state.rate, tasks.rate),
    write: [
      ...state.write,
      ...tasks.write.filter((t) => !writeArticles.has(t.articleId)),
    ],
  })
}

export type FeedItem =
  | { type: 'entry'; entry: ContributionEntry }
  | { type: 'slot'; key: string; tasks: Array<ContributionTask> }

/**
 * The timeline with task slots mixed in: the first slot on top, then one after every `every`
 * entries. Slots left over go at the end, so none is dropped; empty slots are skipped.
 */
export function interleave(
  entries: ReadonlyArray<ContributionEntry>,
  slots: ReadonlyArray<ReadonlyArray<ContributionTask>>,
  every = 3,
): Array<FeedItem> {
  const queue = slots.filter((slot) => slot.length > 0)
  const items: Array<FeedItem> = []
  const next = () => {
    const tasks = queue.shift()
    if (tasks)
      items.push({ type: 'slot', key: taskKey(tasks[0]!), tasks: [...tasks] })
  }
  next()
  entries.forEach((entry, i) => {
    items.push({ type: 'entry', entry })
    if ((i + 1) % every === 0) next()
  })
  while (queue.length) next()
  return items
}
