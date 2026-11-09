import { describe, expect, it } from 'vitest'

import { formatTimeAgo } from '../timeAgo'

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
