// Parsers for the search param fields that the page schemas are built from.
//
// The router hands a schema whatever is in the address bar, so nothing here may trust it: a
// value that is missing, misspelled, out of range or plain garbage falls back to its default
// instead of throwing. A page therefore never needs an error state for a bad URL.
//
// The router reads the query string with lib/urlSearch.ts, so values arrive as the text in the
// address bar: a string, or an array of strings when a key is repeated. A list (`replyType`) is
// written comma-joined (`rumor,not-rumor`); an array is accepted too. Numbers and booleans are
// still turned back into text, in case something hands a schema an already-parsed object.

import { z } from 'zod'

import {
  ARTICLE_STATUSES,
  DEFAULT_RANGE,
  EXCLUSIVE_STATUSES,
  MAX_KEYWORD_LENGTH,
  MAX_TOPICS,
  RANGES,
  REPLY_TYPES,
} from './values'
import type { ArticleStatus, Range } from './values'

// Topic (category) ids are opaque to us; this only keeps out anything that is not id-shaped.
const TOPIC_ID = /^[A-Za-z0-9_-]{1,64}$/

// Invisible characters that only hide or reorder text: zero-width space, direction marks and
// overrides, word joiners, BOM, soft hyphen. ZWJ and ZWNJ stay, since emoji and some scripts need them.
const INVISIBLE =
  /[\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

// The text a number or boolean would have had in the URL.
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
export const pickMany = <const T extends ReadonlyArray<string>>(values: T) =>
  z
    .preprocess(toList, z.array(z.string()))
    .transform(
      (items): Array<T[number]> => values.filter((v) => items.includes(v)),
    )
    .catch([])

/** 被認為, several allowed. */
export const replyTypes = pickMany(REPLY_TYPES).describe(
  'Reply types, any-of: a message matches when any one of its fact-check replies has a ' +
    'selected type. It does not say whether the message is true. rumor = 含有不實訊息, ' +
    'not-rumor = 含有正確訊息, opinionated = 含有個人意見, not-article = 不在查證範圍.',
)

/**
 * 篩選條件 limited to the ones a page offers. When both of an exclusive pair are given, the URL
 * cannot say which one the visitor meant, so neither applies.
 */
export const statuses = (offered: ReadonlyArray<ArticleStatus>) =>
  pickMany(ARTICLE_STATUSES)
    .transform((items) => {
      const shown = items.filter((s) => offered.includes(s))
      return shown.filter(
        (s) =>
          !EXCLUSIVE_STATUSES.some(
            (pair) => pair.includes(s) && pair.every((p) => shown.includes(p)),
          ),
      )
    })
    .catch([])

/** 主題: topic ids, sorted, unique and capped. */
export const topics = z
  .preprocess(toList, z.array(z.string()))
  .transform((items) =>
    [...new Set(items.filter((id) => TOPIC_ID.test(id)))]
      .sort()
      .slice(0, MAX_TOPICS),
  )
  .catch([])

/**
 * Free text: control characters become spaces, invisible ones are removed, whitespace
 * collapses, length is capped.
 */
export const keyword = z
  .preprocess(scalarToString, z.string())
  .transform((text) =>
    Array.from(
      text
        .replace(/\p{Cc}/gu, ' ')
        .replace(INVISIBLE, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
      .slice(0, MAX_KEYWORD_LENGTH)
      .join('')
      // The cut can land on a space; trim again so parsing the result changes nothing.
      .trimEnd(),
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

/** 時間: `range`, and `from` / `to` for a custom range. */
export const rangeFields = {
  range: z.enum(RANGES).catch(DEFAULT_RANGE),
  from: day,
  to: day,
}

/**
 * `from` and `to` only mean something with `range=custom`. Without a usable day the custom range
 * means nothing, so the default range applies. `from` after `to` is also unusable.
 */
export function normalizeRange<
  T extends { range: Range; from?: string; to?: string },
>(search: T): T {
  if (search.range !== 'custom')
    return { ...search, from: undefined, to: undefined }
  const { from, to } = search
  const usable = (from || to) && !(from && to && from > to)
  return usable
    ? search
    : { ...search, range: DEFAULT_RANGE, from: undefined, to: undefined }
}

/** Drops the fields that are `undefined`, so a parsed search has no empty keys. */
export const dropUndefined = <T extends object>(obj: T): T =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T
