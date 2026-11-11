import { describe, expect, it } from 'vitest'

import {
  buildCumulativeSeries,
  interleave,
  mergeTimeline,
  mondayOf,
  seriesStart,
  taipeiDate,
} from '../contributions'
import type { ContributionEntry, ContributionTask } from '../contributions'

// Wednesday 2026-11-11, 20:00 in Taiwan.
const now = new Date('2026-11-11T12:00:00Z')

describe('dates', () => {
  it('uses the Taiwan date', () => {
    expect(taipeiDate(new Date('2026-11-11T17:00:00Z'))).toBe('2026-11-12')
  })

  it('finds Monday, also from a Sunday', () => {
    expect(mondayOf('2026-11-11')).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
  })

  it('starts the chart 11 weeks before this Monday', () => {
    expect(seriesStart(now)).toBe('2026-08-24')
  })
})

describe('buildCumulativeSeries', () => {
  it('adds what came before the window and only goes up', () => {
    const series = buildCumulativeSeries(
      [
        { date: '2026-08-24', count: 2 }, // week 0
        { date: '2026-08-30', count: 1 }, // Sunday, still week 0
        { date: '2026-11-10', count: 4 }, // this week
      ],
      100,
      now,
    )
    expect(series).toHaveLength(12)
    expect(series[0]).toEqual({ weekStart: '2026-08-24', total: 96, added: 3 })
    expect(series[10]?.total).toBe(96)
    expect(series[11]).toEqual({
      weekStart: '2026-11-09',
      total: 100,
      added: 4,
    })
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.total).toBeGreaterThanOrEqual(series[i - 1]!.total)
    }
  })

  it('ignores buckets outside the window and never starts below 0', () => {
    const series = buildCumulativeSeries(
      [
        { date: '2026-08-01', count: 50 },
        { date: '2026-11-11', count: 5 },
      ],
      3,
      now,
    )
    expect(series[0]?.total).toBe(0)
    expect(series[11]?.total).toBe(5)
  })
})

const report = (id: string, createdAt: string): ContributionEntry => ({
  kind: 'report',
  id,
  createdAt,
  articleId: 'a',
  articleText: 't',
  reason: '',
  replyCount: 0,
})
const task = (articleId: string): ContributionTask => ({
  kind: 'write',
  articleId,
  articleText: 't',
  replyRequestCount: 2,
})

describe('mergeTimeline', () => {
  it('sorts newest first and cuts to the limit', () => {
    const merged = mergeTimeline(
      [
        [report('old', '2026-01-01T00:00:00Z')],
        [
          report('new', '2026-03-01T00:00:00Z'),
          report('mid', '2026-02-01T00:00:00Z'),
        ],
      ],
      2,
    )
    expect(merged.map((e) => e.id)).toEqual(['new', 'mid'])
  })
})

describe('interleave', () => {
  it('puts a task first, then one after every 3 entries, and keeps leftovers', () => {
    const entries = ['1', '2', '3', '4'].map((id) =>
      report(id, '2026-01-01T00:00:00Z'),
    )
    const items = interleave(entries, [task('x'), task('y'), task('z')])
    expect(
      items.map((i) => (i.type === 'task' ? i.task.articleId : i.entry.id)),
    ).toEqual(['x', '1', '2', '3', 'y', '4', 'z'])
  })

  it('shows only entries when there is no task', () => {
    const items = interleave([report('1', '2026-01-01T00:00:00Z')], [])
    expect(items).toHaveLength(1)
  })
})
