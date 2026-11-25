// The values the list pages accept in their search params.
//
// Names and values are ours, not rumors-site's: old rumors-site URLs are not supported. They are
// lower-case kebab-case, and the wording follows the UI: 回報 is `reported`, 查核 is `replied`.

/**
 * 被認為 — how a fact-check reply classifies the message. The filter is any-of: a message matches
 * when any one of its replies has a selected type. `not-rumor` (含有正確訊息) does not mean the
 * message is true. Order is the order shown in the filter.
 */
export const REPLY_TYPES = [
  'rumor',
  'not-rumor',
  'opinionated',
  'not-article',
] as const
export type ReplyType = (typeof REPLY_TYPES)[number]

/** 格式 — the kind of message. */
export const ARTICLE_TYPES = ['text', 'image', 'video', 'audio'] as const
export type ArticleType = (typeof ARTICLE_TYPES)[number]

/**
 * 篩選條件 — conditions on a message's reports and replies, several allowed (Penpot list pages).
 * The comments give the label and the rumors-site `filters` value each one replaces.
 */
export const ARTICLE_STATUSES = [
  'reported-once', // 僅一人回報 (ASKED_ONCE): reported by one person
  'reported-many', // 熱門回報 (ASKED_MANY_TIMES): reported two or more times
  'replied-many', // 多份查核 (REPLIED_MANY_TIMES): three or more replies
  'no-useful-reply', // 尚無有效查核 (NO_USEFUL_REPLY_YET)
  'has-useful-reply', // 查核有效 (HAS_USEFUL_REPLY)
  'replied-by-me', // 我查核過的 (REPLIED_BY_ME)
  'not-replied-by-me', // 我沒查過的 (NOT_REPLIED_BY_ME)
  'reported-by-me', // 我送出的: messages the visitor reported first (`selfOnly`); not in Penpot yet
] as const
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number]

/**
 * Statuses about the visitor. A visitor who is not logged in has no such messages, so the query
 * built from the search skips these, and only these: the other conditions still apply.
 */
export const LOGIN_ONLY_STATUSES: ReadonlyArray<ArticleStatus> = [
  'replied-by-me',
  'not-replied-by-me',
  'reported-by-me',
]

/** Pairs that cannot both hold. A URL that selects both keeps neither. */
export const EXCLUSIVE_STATUSES: ReadonlyArray<
  readonly [ArticleStatus, ArticleStatus]
> = [
  ['reported-once', 'reported-many'],
  ['no-useful-reply', 'has-useful-reply'],
  ['replied-by-me', 'not-replied-by-me'],
]

/**
 * 時間. `day`, `week` and `month` count back from now (1, 7 and 30 days); `all` is no limit and is
 * the default on every page (時間不限); `custom` uses `from` and `to`. Each page says which time
 * field it filters.
 */
export const RANGES = ['all', 'day', 'week', 'month', 'custom'] as const
export type Range = (typeof RANGES)[number]
export const DEFAULT_RANGE: Range = 'all'

/** 排序 on /articles. */
export const ARTICLE_SORTS = [
  'latest-reported', // most recently reported (lastRequestedAt), the default
  'most-reported', // reported by the most people (replyRequestCount)
  'latest-replied', // most recently fact-checked (lastRepliedAt)
] as const
export type ArticleSort = (typeof ARTICLE_SORTS)[number]

/** 排序 on /replies: the same orders, most recently fact-checked first by default. */
export const REPLY_LIST_SORTS = [
  'latest-replied',
  'latest-reported',
  'most-reported',
] as const
export type ReplyListSort = (typeof REPLY_LIST_SORTS)[number]

/** 排序 on a user's replies tab. */
export const USER_REPLY_SORTS = [
  'my-reply', // this user's reply, newest first (lastMatchingArticleReplyCreatedAt), the default
  'latest-replied',
  'latest-reported',
  'most-reported',
] as const
export type UserReplySort = (typeof USER_REPLY_SORTS)[number]

/** /search: search the messages or the replies. Same values as rumors-site. */
export const SEARCH_TYPES = ['messages', 'replies'] as const
export type SearchType = (typeof SEARCH_TYPES)[number]

/** The tabs of a user page. Same values as rumors-site. */
export const USER_TABS = ['replies', 'comments'] as const
export type UserTab = (typeof USER_TABS)[number]

/**
 * The keyword's length cap. /search matches whole messages (`moreLikeThis`), and people paste a
 * message they received, so this is rumors-site's 500 and not a short query's length.
 */
export const MAX_KEYWORD_LENGTH = 500
export const MAX_TOPICS = 20
