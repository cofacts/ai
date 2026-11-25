import { describe, expect, it } from 'vitest'

import { resolveTimeRange } from '../timeRange'

describe('resolveTimeRange', () => {
  const now = new Date('2026-11-20T04:00:00.000Z')

  it('all is no limit', () => {
    expect(resolveTimeRange({ range: 'all' }, now)).toBeUndefined()
  })

  it('counts back from the start of the hour, with no end', () => {
    expect(resolveTimeRange({ range: 'week' }, now)).toEqual({
      gte: '2026-11-13T04:00:00.000Z',
    })
    expect(resolveTimeRange({ range: 'day' }, now)?.gte).toBe(
      '2026-11-19T04:00:00.000Z',
    )
    expect(resolveTimeRange({ range: 'month' }, now)?.gte).toBe(
      '2026-10-21T04:00:00.000Z',
    )
  })

  it('stays the same within the hour', () => {
    const later = new Date('2026-11-20T04:59:59.999Z')
    expect(resolveTimeRange({ range: 'day' }, later)).toEqual(
      resolveTimeRange({ range: 'day' }, now),
    )
  })

  it('custom days are whole Taiwan days', () => {
    expect(
      resolveTimeRange(
        { range: 'custom', from: '2026-10-01', to: '2026-10-31' },
        now,
      ),
    ).toEqual({
      gte: '2026-10-01T00:00:00.000+08:00',
      lte: '2026-10-31T23:59:59.999+08:00',
    })
    expect(
      resolveTimeRange({ range: 'custom', from: '2026-10-01' }, now),
    ).toEqual({ gte: '2026-10-01T00:00:00.000+08:00' })
  })

  it('custom bounds are dates the API can parse', () => {
    const r = resolveTimeRange(
      { range: 'custom', from: '2026-10-01', to: '2026-10-31' },
      now,
    )
    expect(Number.isNaN(Date.parse(r?.gte ?? ''))).toBe(false)
    expect(Number.isNaN(Date.parse(r?.lte ?? ''))).toBe(false)
  })
})
