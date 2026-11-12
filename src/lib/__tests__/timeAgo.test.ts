import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime, formatTimeAgo } from '../timeAgo'

const now = new Date('2026-11-06T12:00:00+08:00')
const ago = (ms: number) => new Date(now.getTime() - ms)
const HOUR = 3600_000
const DAY = 24 * HOUR

describe('formatTimeAgo', () => {
  it('uses the largest whole unit', () => {
    expect(formatTimeAgo(ago(DAY), now)).toBe('1 天前')
    expect(formatTimeAgo(ago(3 * HOUR + 59 * 60_000), now)).toBe('3 小時前')
    expect(formatTimeAgo(ago(45 * DAY), now)).toBe('1 個月前')
    expect(formatTimeAgo(ago(800 * DAY), now)).toBe('2 年前')
  })

  it('never reads 12 個月前: the month count stops at 11 until a full year', () => {
    expect(formatTimeAgo(ago(359 * DAY), now)).toBe('11 個月前')
    expect(formatTimeAgo(ago(364 * DAY), now)).toBe('11 個月前')
    expect(formatTimeAgo(ago(365 * DAY), now)).toBe('1 年前')
  })

  it('says 1 天前, not 昨天', () => {
    expect(formatTimeAgo(ago(DAY + HOUR), now)).toBe('1 天前')
  })

  it('takes an ISO string, as rumors-api returns', () => {
    expect(formatTimeAgo('2026-11-04T12:00:00+08:00', now)).toBe('2 天前')
  })

  it('reads a future date as now instead of a negative time', () => {
    expect(formatTimeAgo(new Date(now.getTime() + 5000), now)).toBe('0 秒前')
  })
})

describe('formatDate', () => {
  it('reads as time ago within 48 hours', () => {
    expect(formatDate(ago(2 * 60_000), now)).toBe('2 分鐘前')
    expect(formatDate(ago(48 * HOUR - 1), now)).toBe('1 天前')
  })

  it('reads as the date from 48 hours on', () => {
    expect(formatDate(ago(48 * HOUR), now)).toBe('11月4日')
    expect(formatDate('2026-03-01T10:00:00+08:00', now)).toBe('3月1日')
  })

  it('adds the year when it is not the year of now', () => {
    expect(formatDate('2024-04-02T10:00:00+08:00', now)).toBe('2024年4月2日')
  })

  it('reads the date in Taipei, not in the server time zone', () => {
    // 01:00 on 4 Nov in Taipei is still 3 Nov in UTC, where Cloud Run runs.
    expect(formatDate('2026-11-03T17:00:00Z', now)).toBe('11月4日')
  })

  it('compares years in Taipei, for both the date and now', () => {
    // 01:00 on 1 Jan 2027 in Taipei is still 2026 in UTC.
    const newYear = '2027-01-01T01:00:00+08:00'
    expect(formatDate(newYear, new Date('2027-01-03T12:00:00+08:00'))).toBe(
      '1月1日',
    )
    expect(formatDate('2026-06-01T12:00:00+08:00', new Date(newYear))).toBe(
      '2026年6月1日',
    )
  })
})

describe('formatDateTime', () => {
  it('reads the full date and time in Taipei, for a tooltip', () => {
    expect(formatDateTime('2024-04-02T01:05:00Z')).toBe('2024年4月2日 上午9:05')
    expect(formatDateTime('2026-11-04T14:30:00+08:00')).toBe(
      '2026年11月4日 下午2:30',
    )
  })
})

describe('dates that do not parse', () => {
  it('read as the original string instead of throwing', () => {
    expect(formatTimeAgo('not a date', now)).toBe('not a date')
    expect(formatDate('not a date', now)).toBe('not a date')
    expect(formatDateTime('not a date')).toBe('not a date')
  })

  it('read the date with its year when now does not parse', () => {
    const invalidNow = new Date(NaN)
    expect(formatTimeAgo('2026-11-04T12:00:00+08:00', invalidNow)).toBe(
      '2026年11月4日',
    )
    expect(formatDate('2026-11-04T12:00:00+08:00', invalidNow)).toBe(
      '2026年11月4日',
    )
  })
})
