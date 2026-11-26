// The search param schemas of the list pages, and the route options that use them.
//
// Every list page keeps its filters in the URL, so a link can be shared and Reload / Back restores
// the same view. A route takes them by spreading its page's options:
// `createFileRoute('/articles')({ ...articleListSearch, component })`. Each page takes only the
// conditions it offers; anything else in the URL is dropped.
//
// Each schema notes which time field `range` filters, since that differs between pages.
// Pagination is not in the URL: Back restores it from the query cache and scroll restoration.

import { stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'

import {
  dropUndefined,
  keyword,
  normalizeRange,
  pickMany,
  rangeFields,
  replyTypes,
  statuses,
  topics,
} from './fields'
import {
  ARTICLE_SORTS,
  ARTICLE_STATUSES,
  ARTICLE_TYPES,
  REPLY_LIST_SORTS,
  SEARCH_TYPES,
  USER_REPLY_SORTS,
  USER_TABS,
} from './values'

/**
 * The schemas accept anything, so zod infers `unknown` as their input. The router checks
 * `<Link search>` and `navigate({ search })` against that input type, so a typo such as
 * `sort: 'most-reproted'` would compile and quietly become the default. This restates the input:
 * a link may set any of the parsed fields, with the values the page accepts, and leave out the rest.
 */
const typedInput = <TSchema extends z.ZodType>(schema: TSchema) =>
  schema as unknown as z.ZodType<z.output<TSchema>, Partial<z.output<TSchema>>>

/**
 * /articles — 可疑訊息. `range` filters when the message was first reported (`createdAt`).
 */
export const articleListSearchSchema = typedInput(
  z
    .object({
      q: keyword,
      status: statuses(ARTICLE_STATUSES),
      replyType: replyTypes,
      articleType: pickMany(ARTICLE_TYPES),
      topic: topics,
      ...rangeFields,
      sort: z.enum(ARTICLE_SORTS).catch('latest-reported'),
    })
    .transform((s) => dropUndefined(normalizeRange(s))),
)
export type ArticleListSearch = z.output<typeof articleListSearchSchema>

/**
 * /replies — 最新查核: messages that have fact-check replies, most recently fact-checked first.
 * `range` filters when they were fact-checked (`repliedAt`). Penpot shows no 格式 filter here, and
 * 我送出的 is only on /articles and /search.
 */
export const replyListSearchSchema = typedInput(
  z
    .object({
      status: statuses(ARTICLE_STATUSES.filter((s) => s !== 'reported-by-me')),
      replyType: replyTypes,
      topic: topics,
      ...rangeFields,
      sort: z.enum(REPLY_LIST_SORTS).catch('latest-replied'),
    })
    .transform((s) => dropUndefined(normalizeRange(s))),
)
export type ReplyListSearch = z.output<typeof replyListSearchSchema>

/**
 * /hoax-for-you — 等你來答: messages still waiting for a reply. Only topics and time can be chosen;
 * the rest of the filter and the order are fixed by the page. `range` filters `createdAt`.
 */
export const hoaxForYouSearchSchema = typedInput(
  z
    .object({
      topic: topics,
      ...rangeFields,
    })
    .transform((s) => dropUndefined(normalizeRange(s))),
)
export type HoaxForYouSearch = z.output<typeof hoaxForYouSearchSchema>

/**
 * /search — `q` searched in the messages or in the replies (`type`, as on rumors-site). Without
 * `q` the page shows an empty state. `range` filters `createdAt`.
 *
 * Searching replies offers fewer conditions: 篩選條件 is only 我查核過的, and there is no topic.
 */
export const searchPageSearchSchema = typedInput(
  z
    .object({
      q: keyword,
      type: z.enum(SEARCH_TYPES).catch('messages'),
      status: statuses(ARTICLE_STATUSES),
      replyType: replyTypes,
      topic: topics,
      ...rangeFields,
    })
    .transform((s) =>
      s.type === 'replies'
        ? {
            ...s,
            status: s.status.filter((x) => x === 'replied-by-me'),
            topic: [],
          }
        : s,
    )
    .transform((s) => dropUndefined(normalizeRange(s))),
)
export type SearchPageSearch = z.output<typeof searchPageSearchSchema>

/**
 * /user/:slug and /user?id= — a user's page. The replies tab lists the messages this user
 * replied to, and `range` filters when this user replied (`articleReply.createdAt`). The comments
 * tab has no conditions, so they are dropped there.
 */
export const userPageSearchSchema = typedInput(
  z
    .object({
      tab: z.enum(USER_TABS).catch('replies'),
      replyType: replyTypes,
      articleType: pickMany(ARTICLE_TYPES),
      topic: topics,
      ...rangeFields,
      sort: z.enum(USER_REPLY_SORTS).catch('my-reply'),
    })
    .transform((s) =>
      s.tab === 'comments'
        ? {
            tab: s.tab,
            replyType: [],
            articleType: [],
            topic: [],
            range: 'all' as const,
            sort: 'my-reply' as const,
          }
        : s,
    )
    .transform((s) => dropUndefined(normalizeRange(s))),
)
export type UserPageSearch = z.output<typeof userPageSearchSchema>

// What each page shows with nothing in the URL.
export const articleListDefaults = articleListSearchSchema.parse({})
export const replyListDefaults = replyListSearchSchema.parse({})
export const hoaxForYouDefaults = hoaxForYouSearchSchema.parse({})
export const searchPageDefaults = searchPageSearchSchema.parse({})
export const userPageDefaults = userPageSearchSchema.parse({})

/**
 * A page's route search options: the schema, and a middleware that drops each value equal to the
 * page's default. `useSearch()` returns every field, defaults included, so without it a link
 * written as `search: (prev) => ({ ...prev, q })` would carry all of them. With it a shared link
 * holds only what the visitor changed (`/articles?q=疫苗`).
 */
const searchOptions = <T extends object>(
  schema: z.ZodType<T, Partial<T>>,
  defaults: T,
) => ({
  validateSearch: schema,
  search: { middlewares: [stripSearchParams<Partial<T>>(defaults)] },
})

export const articleListSearch = searchOptions(
  articleListSearchSchema,
  articleListDefaults,
)
export const replyListSearch = searchOptions(
  replyListSearchSchema,
  replyListDefaults,
)
export const hoaxForYouSearch = searchOptions(
  hoaxForYouSearchSchema,
  hoaxForYouDefaults,
)
export const searchPageSearch = searchOptions(
  searchPageSearchSchema,
  searchPageDefaults,
)
export const userPageSearch = searchOptions(
  userPageSearchSchema,
  userPageDefaults,
)
