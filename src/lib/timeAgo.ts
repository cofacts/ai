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

/**
 * How long ago `date` was, in the largest whole unit: 「1 天前」「3 小時前」「2 個月前」.
 * `numeric: 'always'` keeps 「1 天前」 instead of 「昨天」, the wording Penpot uses.
 * A date in the future (clock skew between server and browser) reads as now.
 */
export function formatTimeAgo(date: Date | string, now: Date = new Date()) {
  const elapsed = Math.max(0, now.getTime() - new Date(date).getTime())
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return rtf.format(-Math.floor(elapsed / ms), unit)
  }
  return rtf.format(-Math.floor(elapsed / SECOND), 'second')
}
