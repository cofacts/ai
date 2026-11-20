// URL search params of the list pages: names, accepted values, and the parser.
//
// Every list page (/articles, /replies, a user's profile, search) keeps its filters in the URL
// so a link can be shared and Reload / Back restores the same view. The router hands us whatever
// is in the address bar, so nothing here may trust it: a value that is missing, misspelled,
// out of range or plain garbage falls back to its default instead of throwing. A page therefore
// never needs an error state for a bad URL.
//
// Names and values are ours, not rumors-site's: old rumors-site URLs are not supported.
//
// Use it from a route as `validateSearch: articleListSearchSchema` (zod implements Standard
// Schema, which the router accepts directly). Each page takes only the conditions that make
// sense on it; anything else in the URL is dropped.
//
// Two things about the router's own parsing that the schemas below deal with:
// - it JSON-parses each value, so `?q=123` arrives as the number 123 and `?q=true` as `true`;
// - a list value (`replyType`) arrives as text (`rumor,not-rumor`) or, when the router wrote it,
//   as a JSON array. Both are accepted.

import { z } from 'zod'

// --- values -------------------------------------------------------------------------------

/** 回應分類 — how a reply classifies the message. Order is the order shown in the filter. */
export const REPLY_TYPES = [
  'rumor',
  'not-rumor',
  'opinionated',
  'not-article',
] as const
export type ReplyType = (typeof REPLY_TYPES)[number]

/** 訊息類型. */
export const ARTICLE_TYPES = ['text', 'image', 'video', 'audio'] as const
export type ArticleType = (typeof ARTICLE_TYPES)[number]

/** 回應狀態 — whether the message has a fact-check reply yet. */
export const REPLY_STATUSES = ['all', 'replied', 'unreplied'] as const
export type ReplyStatus = (typeof REPLY_STATUSES)[number]

/**
 * 時間區間. `week`, `month` and `quarter` count back from now (7, 30 and 90 days); `all` is no
 * limit; `custom` uses `from` and `to`.
 */
export const RANGES = ['week', 'month', 'quarter', 'all', 'custom'] as const
export type Range = (typeof RANGES)[number]
export const DEFAULT_RANGE: Range = 'month'

export const ARTICLE_SORTS = [
  'latest-reported', // most recently reported again (default)
  'most-reported', // most people reported it
  'newest', // first reported most recently
  'latest-replied', // most recently fact-checked
] as const
export type ArticleSort = (typeof ARTICLE_SORTS)[number]

export const REPLY_SORTS = [
  'newest',
  'relevance', // needs a keyword; without one the default applies
] as const
export type ReplySort = (typeof REPLY_SORTS)[number]

/** Where a keyword is searched: in the messages, or in the replies. */
export const SEARCH_TARGETS = ['article', 'reply'] as const
export type SearchTarget = (typeof SEARCH_TARGETS)[number]

/** A user's profile page: the messages they replied to, or the ones they reported. */
export const PROFILE_TABS = ['replies', 'reports'] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

export const MAX_KEYWORD_LENGTH = 200
export const MAX_TOPICS = 20
// Topic (category) ids are opaque to us; this only keeps out anything that is not id-shaped.
const TOPIC_ID = /^[A-Za-z0-9_-]{1,64}$/

// --- field parsers ------------------------------------------------------------------------

// The router turns `?q=123` into a number and `?x=true` into a boolean.
const scalarToString = (raw: unknown) =>
  typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw

/** `a,b`, `['a','b']` or a single scalar, as a list of trimmed strings. Anything else: empty. */
const toList = (raw: unknown): Array<string> => {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [raw]
  return items
    .map(scalarToString)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Several values from a fixed set. Unknown ones are dropped (not the whole list), duplicates
 * collapse, and the result follows the order of `values`, so equal selections give equal URLs.
 */
const pickMany = <const T extends ReadonlyArray<string>>(values: T) =>
  z
    .preprocess(toList, z.array(z.string()))
    .transform(
      (items): Array<T[number]> => values.filter((v) => items.includes(v)),
    )
    .catch([])

const topics = z
  .preprocess(toList, z.array(z.string()))
  .transform((items) =>
    [...new Set(items.filter((id) => TOPIC_ID.test(id)))]
      .sort()
      .slice(0, MAX_TOPICS),
  )
  .catch([])

/** Free text: control characters become spaces, whitespace collapses, length is capped. */
const keyword = z
  .preprocess(scalarToString, z.string())
  .transform((text) =>
    Array.from(
      text
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
      .slice(0, MAX_KEYWORD_LENGTH)
      .join(''),
  )
  .catch('')

/** `YYYY-MM-DD` that is a real calendar day (not 2026-02-31). Anything else: absent. */
const isCalendarDay = (text: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const [y, m, d] = match.slice(1).map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  )
}
const day = z
  .preprocess(scalarToString, z.string().refine(isCalendarDay).optional())
  .catch(undefined)

/**
 * `from` and `to` only mean something with `range=custom`. Without a usable pair the custom
 * range is meaningless, so the page's default range applies. `from` after `to` is also unusable.
 */
function normalizeRange<T extends { range: Range; from?: string; to?: string }>(
  search: T,
  defaultRange: Range,
): T {
  if (search.range !== 'custom')
    return { ...search, from: undefined, to: undefined }
  const { from, to } = search
  const usable = (from || to) && !(from && to && from > to)
  return usable
    ? search
    : { ...search, range: defaultRange, from: undefined, to: undefined }
}

const dropUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T

const rangeFields = (defaultRange: Range) => ({
  range: z.enum(RANGES).catch(defaultRange),
  from: day,
  to: day,
})

// --- page schemas -------------------------------------------------------------------------

/** /articles — the list of messages (可疑訊息). */
export const articleListSearchSchema = z
  .object({
    q: keyword,
    status: z.enum(REPLY_STATUSES).catch('all'),
    replyType: pickMany(REPLY_TYPES),
    articleType: pickMany(ARTICLE_TYPES),
    topic: topics,
    ...rangeFields(DEFAULT_RANGE),
    sort: z.enum(ARTICLE_SORTS).catch('latest-reported'),
  })
  .transform((s) => dropUndefined(normalizeRange(s, DEFAULT_RANGE)))
export type ArticleListSearch = z.output<typeof articleListSearchSchema>

/** /replies — the list of fact-check replies (查核回應). */
export const replyListSearchSchema = z
  .object({
    q: keyword,
    replyType: pickMany(REPLY_TYPES),
    topic: topics,
    ...rangeFields(DEFAULT_RANGE),
    sort: z.enum(REPLY_SORTS).catch('newest'),
  })
  // Relevance only exists when there is something to be relevant to.
  .transform((s) => ({
    ...s,
    sort: s.sort === 'relevance' && !s.q ? ('newest' as const) : s.sort,
  }))
  .transform((s) => dropUndefined(normalizeRange(s, DEFAULT_RANGE)))
export type ReplyListSearch = z.output<typeof replyListSearchSchema>

/** The search page: one keyword, searched in messages or in replies. */
export const searchPageSearchSchema = z
  .object({
    q: keyword,
    in: z.enum(SEARCH_TARGETS).catch('article'),
    ...rangeFields('all'),
  })
  .transform((s) => dropUndefined(normalizeRange(s, 'all')))
export type SearchPageSearch = z.output<typeof searchPageSearchSchema>

/** A user's profile page. */
export const profileSearchSchema = z.object({
  tab: z.enum(PROFILE_TABS).catch('replies'),
})
export type ProfileSearch = z.output<typeof profileSearchSchema>

// --- using the result ---------------------------------------------------------------------

/**
 * The search without the values that equal the page's defaults, so a shared link carries only
 * what the visitor changed (`/articles?q=疫苗`, not eight params).
 */
export function omitDefaults<T extends object>(
  search: T,
  defaults: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(search).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(defaults[key as keyof T]),
    ),
  ) as Partial<T>
}

const DAY_MS = 24 * 60 * 60 * 1000
const RANGE_DAYS = { week: 7, month: 30, quarter: 90 } as const

export type TimeRange = { gte?: string; lte?: string }

/**
 * The `TimeRangeInput` (`GTE`/`LTE` in ISO time) for a parsed range, or `undefined` for no
 * limit. Custom days are Taiwan days, as the people filtering are: `from` starts at 00:00 and
 * `to` ends at 23:59:59.999, UTC+8. `now` is a parameter so the same URL renders the same on
 * server and browser within a page load.
 */
export function resolveTimeRange(
  search: { range: Range; from?: string; to?: string },
  now: Date,
): TimeRange | undefined {
  if (search.range === 'all') return undefined
  if (search.range === 'custom') {
    const range: TimeRange = {}
    if (search.from) range.gte = `${search.from}T00:00:00.000+08:00`
    if (search.to) range.lte = `${search.to}T23:59:59.999+08:00`
    return range
  }
  return {
    gte: new Date(
      now.getTime() - RANGE_DAYS[search.range] * DAY_MS,
    ).toISOString(),
    lte: now.toISOString(),
  }
}
