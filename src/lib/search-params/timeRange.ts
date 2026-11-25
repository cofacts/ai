import type { Range } from './values'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const RANGE_DAYS = { day: 1, week: 7, month: 30 } as const

export type TimeRange = { gte?: string; lte?: string }

/**
 * The `TimeRangeInput` (`GTE`/`LTE` in ISO time) for a parsed range, or `undefined` for no
 * limit. The page decides which time field it goes to (see the schemas in pages.ts).
 *
 * Custom days are Taiwan days, as the people filtering are: `from` starts at 00:00 and `to` ends
 * at 23:59:59.999, UTC+8.
 *
 * `day`, `week` and `month` start from `now` rounded down to the hour and have no end. The result
 * then stays the same for the whole hour, so a query key built from it does not change on every
 * render, and the server and browser agree unless the hour turns between them. The window is up
 * to an hour longer than 1, 7 or 30 days, and the newest messages are still included.
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
  const hour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS
  return {
    gte: new Date(hour - RANGE_DAYS[search.range] * DAY_MS).toISOString(),
  }
}
