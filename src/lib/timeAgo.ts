const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * DAY],
  ['month', 30 * DAY],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
]

// zh-TW is hard-coded until lingui decides the locale (kb Phase 3 §2.5).
const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'always' })

const isValid = (d: Date) => !Number.isNaN(d.getTime())

/**
 * How long ago `date` was, in the largest whole unit: 「1 天前」「3 小時前」「2 個月前」.
 * `numeric: 'always'` keeps 「1 天前」 instead of 「昨天」, the wording Penpot uses.
 * A date in the future (clock skew between server and browser) reads as now.
 * A date that does not parse reads as the original string; with a `now` that does not parse,
 * there is nothing to count from, so it reads as the date with its year (「2026年11月4日」).
 */
export function formatTimeAgo(date: Date | string, now: Date = new Date()) {
  const d = new Date(date)
  if (!isValid(d)) return String(date)
  if (!isValid(now)) return dayWithYearFormat.format(d)
  const elapsed = Math.max(0, now.getTime() - d.getTime())
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) {
      const count = Math.floor(elapsed / ms)
      // 12 months of 30 days is 360 days, short of a 365-day year: stop at 11 so it never reads 「12 個月前」.
      return rtf.format(-(unit === 'month' ? Math.min(count, 11) : count), unit)
    }
  }
  return rtf.format(-Math.floor(elapsed / SECOND), 'second')
}

// Dates read in Taipei on the server (Cloud Run runs in UTC) and in the browser alike,
// so both render the same string.
const timeZone = 'Asia/Taipei'
const yearFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone,
  year: 'numeric',
})
const dayFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone,
  month: 'short',
  day: 'numeric',
})
const dayWithYearFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const dateTimeFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Time ago within 48 hours (「3 小時前」), the date after that (「11月4日」), with the year only
 * when it is not the year of `now` (「2024年4月2日」). Users asked for dates instead of 「N 天前」
 * in the 2021 user profile pilot study, and cofacts.tw has read this way since rumors-site#419.
 * Dates that do not parse read as in `formatTimeAgo`.
 */
export function formatDate(date: Date | string, now: Date = new Date()) {
  const d = new Date(date)
  if (!isValid(d) || !isValid(now)) return formatTimeAgo(date, now)
  if (now.getTime() - d.getTime() < 2 * DAY) return formatTimeAgo(d, now)
  const sameYear = yearFormat.format(d) === yearFormat.format(now)
  return (sameYear ? dayFormat : dayWithYearFormat).format(d)
}

/** The full date and time, 「2024年4月2日 上午9:05」, for the tooltip of a date from `formatDate`. */
export function formatDateTime(date: Date | string) {
  const d = new Date(date)
  return isValid(d) ? dateTimeFormat.format(d) : String(date)
}
