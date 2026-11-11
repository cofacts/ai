import { describe, expect, it } from 'vitest'

import {
  addRateTasks,
  buildCumulativeSeries,
  composeTaskSlots,
  initTaskSlots,
  initialTimelineCursor,
  interleave,
  loadTimelinePage,
  mergeRatePool,
  mergeTimelinePage,
  mondayOf,
  parseTimelineCursor,
  recordVote,
  seriesStart,
  sortRateTasks,
  syncTaskSlots,
  taipeiDate,
  taskKey,
  unshownRateTasks,
} from '../contributions'
import type {
  ContributionEntry,
  ContributionTask,
  RateTask,
  TimelineCursor,
  TimelineEdge,
  WriteTask,
} from '../contributions'

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
const write = (articleId: string): WriteTask => ({
  kind: 'write',
  articleId,
  articleText: 't',
  replyRequestCount: 2,
})
const rate = (
  articleId: string,
  reason: RateTask['reason'] = 'needs-rating',
): RateTask => ({
  kind: 'rate',
  reason,
  articleId,
  articleText: 't',
  replyId: `r-${articleId}`,
  replyText: 'r',
  replyType: 'RUMOR',
  feedbackCount: 0,
})
const rk = (articleId: string) => taskKey(rate(articleId))
const ids = (tasks: ReadonlyArray<ContributionTask>) =>
  tasks.map((t) => t.articleId)

const octDay = (day: number) =>
  `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`

/** Edges with ids `${prefix}${day}`, one per given day of October 2026 (newest first). */
function edges(
  prefix: string,
  days: ReadonlyArray<number>,
): Array<TimelineEdge> {
  return days.map((day) => ({
    cursor: `${prefix}${day}`,
    createdAt: octDay(day),
    entry: report(`${prefix}${day}`, octDay(day)),
  }))
}
/** An edge the page can't show (e.g. a neutral rating); `day` null for one without a date. */
const hidden = (cursor: string, day: number | null): TimelineEdge => ({
  cursor,
  createdAt: day === null ? null : octDay(day),
  entry: null,
})
const entryIds = (entries: ReadonlyArray<ContributionEntry>) =>
  entries.map((e) => e.id)

describe('mergeTimelinePage', () => {
  it('interleaves the lists newest first and moves each cursor to the last item taken', () => {
    const page = mergeTimelinePage(
      initialTimelineCursor(),
      {
        reports: edges('q', [30, 27, 24]),
        replies: edges('r', [29, 26, 23]),
        feedbacks: edges('f', [28, 25, 22]),
      },
      4,
    )
    expect(entryIds(page.entries)).toEqual(['q30', 'r29', 'f28', 'q27'])
    expect(page.nextCursor).toEqual({
      reports: { after: 'q27', done: false },
      replies: { after: 'r29', done: false },
      feedbacks: { after: 'f28', done: false },
    })
  })

  it('does not move past items it did not take, so they come back on the next page', () => {
    const first = mergeTimelinePage(
      initialTimelineCursor(),
      {
        reports: edges('q', [30, 29]),
        replies: edges('r', [10, 9]),
        feedbacks: [],
      },
      2,
    )
    expect(entryIds(first.entries)).toEqual(['q30', 'q29'])
    expect(first.nextCursor?.replies).toEqual({ after: null, done: false })
    // Feedbacks returned nothing: done.
    expect(first.nextCursor?.feedbacks).toEqual({ after: null, done: true })

    const second = mergeTimelinePage(
      first.nextCursor!,
      { reports: edges('q', [5]), replies: edges('r', [10, 9]) },
      2,
    )
    expect(entryIds(second.entries)).toEqual(['r10', 'r9'])
    // Reports had fewer than a page but one was left: not done yet.
    expect(second.nextCursor?.reports).toEqual({ after: 'q29', done: false })
    expect(second.nextCursor?.replies).toEqual({ after: 'r9', done: false })
  })

  it('marks a list done when it ran out and everything was taken, and ignores done lists', () => {
    const page = mergeTimelinePage(
      {
        reports: { after: 'q1', done: true },
        replies: { after: null, done: false },
        feedbacks: { after: null, done: false },
      },
      {
        reports: edges('q', [31]), // must be ignored: the list is done
        replies: edges('r', [20]),
        feedbacks: edges('f', [21, 19, 18]),
      },
      3,
    )
    expect(entryIds(page.entries)).toEqual(['f21', 'r20', 'f19'])
    expect(page.nextCursor).toEqual({
      reports: { after: 'q1', done: true },
      replies: { after: 'r20', done: true },
      feedbacks: { after: 'f19', done: false },
    })
  })

  it('returns a null cursor when all lists ran out', () => {
    const page = mergeTimelinePage(
      initialTimelineCursor(),
      { reports: edges('q', [3]), replies: [], feedbacks: edges('f', [2]) },
      20,
    )
    expect(entryIds(page.entries)).toEqual(['q3', 'f2'])
    expect(page.nextCursor).toBeNull()
  })

  it('handles empty lists', () => {
    const page = mergeTimelinePage(initialTimelineCursor(), {
      reports: [],
      replies: [],
      feedbacks: [],
    })
    expect(page).toEqual({ entries: [], nextCursor: null })
  })

  it('consumes items it cannot show', () => {
    const page = mergeTimelinePage(
      initialTimelineCursor(),
      {
        reports: [
          ...edges('q', [30]),
          hidden('bad', null),
          ...edges('q', [10]),
        ],
        replies: edges('r', [20, 19]),
        feedbacks: [],
      },
      3,
    )
    expect(entryIds(page.entries)).toEqual(['q30', 'r20', 'r19'])
    // q10 wasn't taken, so the cursor stays at q30 and 'bad' is fetched (and skipped) again.
    expect(page.nextCursor?.reports).toEqual({ after: 'q30', done: false })

    const trailing = mergeTimelinePage(
      initialTimelineCursor(),
      {
        reports: [...edges('q', [30]), hidden('bad', null)],
        replies: [],
        feedbacks: [],
      },
      3,
    )
    expect(trailing.nextCursor).toBeNull()
  })

  it('counts edges it cannot show by their date, so pages stay in order', () => {
    // The verifier's case: a hidden reply (a neutral rating, say) newer than the feedbacks.
    const first = mergeTimelinePage(
      initialTimelineCursor(),
      {
        reports: [],
        replies: [...edges('r', [28]), hidden('rh', 26)],
        feedbacks: edges('f', [20, 10]),
      },
      2,
    )
    // r28 and the hidden reply fill the page: f20 must wait, as r25 may come before it.
    expect(entryIds(first.entries)).toEqual(['r28'])
    expect(first.nextCursor?.replies).toEqual({ after: 'rh', done: false })
    expect(first.nextCursor?.feedbacks).toEqual({ after: null, done: false })

    const second = mergeTimelinePage(
      first.nextCursor!,
      { replies: edges('r', [25]), feedbacks: edges('f', [20, 10]) },
      2,
    )
    expect(entryIds(second.entries)).toEqual(['r25', 'f20'])
    const third = mergeTimelinePage(
      second.nextCursor!,
      { feedbacks: edges('f', [10]) },
      2,
    )
    expect(entryIds(third.entries)).toEqual(['f10'])
    expect(third.nextCursor).toBeNull()
  })

  it('places an edge without a date after the dated edges of its batch', () => {
    const page = mergeTimelinePage(
      initialTimelineCursor(),
      {
        reports: [hidden('undated', null), ...edges('q', [30, 5])],
        replies: edges('r', [20]),
        feedbacks: [],
      },
      3,
    )
    // Not taken first: q30, r20 and q5 are newer than "after the batch's oldest".
    expect(entryIds(page.entries)).toEqual(['q30', 'r20', 'q5'])
    // Passed over by the cursor (it can't be shown anyway).
    expect(page.nextCursor?.reports).toEqual({ after: 'q5', done: false })
  })
})

describe('loadTimelinePage', () => {
  /** A fake rumors-api: each list is an array of edges; fetches `pageSize` after the cursor. */
  function api(
    lists: Partial<
      Record<'reports' | 'replies' | 'feedbacks', Array<TimelineEdge>>
    >,
    pageSize: number,
  ) {
    let calls = 0
    const fetchLists = (cursor: TimelineCursor) => {
      calls++
      const out: Partial<Record<keyof TimelineCursor, Array<TimelineEdge>>> = {}
      for (const list of ['reports', 'replies', 'feedbacks'] as const) {
        if (cursor[list].done) continue
        const all = lists[list] ?? []
        const start =
          cursor[list].after === null
            ? 0
            : all.findIndex((e) => e.cursor === cursor[list].after) + 1
        out[list] = all.slice(start, start + pageSize)
      }
      return Promise.resolve(out)
    }
    return { fetchLists, calls: () => calls }
  }

  it('fetches again when a page took only edges it cannot show', async () => {
    const { fetchLists, calls } = api(
      {
        reports: [hidden('h1', 30), hidden('h2', 29), ...edges('q', [28, 27])],
      },
      2,
    )
    const page = await loadTimelinePage(initialTimelineCursor(), fetchLists, 2)
    expect(entryIds(page.entries)).toEqual(['q28', 'q27'])
    expect(calls()).toBe(2)
  })

  it('gives up after maxRounds, returning an empty page that can continue', async () => {
    const { fetchLists, calls } = api(
      {
        reports: [
          hidden('h1', 30),
          hidden('h2', 29),
          hidden('h3', 28),
          ...edges('q', [27]),
        ],
      },
      1,
    )
    const page = await loadTimelinePage(
      initialTimelineCursor(),
      fetchLists,
      1,
      2,
    )
    expect(page.entries).toEqual([])
    expect(page.nextCursor?.reports.after).toBe('h2')
    expect(calls()).toBe(2)
  })

  it('stops when everything ran out', async () => {
    const { fetchLists, calls } = api({ reports: [hidden('h1', 30)] }, 2)
    const page = await loadTimelinePage(initialTimelineCursor(), fetchLists, 2)
    expect(page).toEqual({ entries: [], nextCursor: null })
    expect(calls()).toBe(1)
  })
})

describe('parseTimelineCursor', () => {
  it('accepts null and a well-formed cursor', () => {
    expect(parseTimelineCursor(null)).toBeNull()
    const cursor = initialTimelineCursor()
    expect(parseTimelineCursor(cursor)).toEqual(cursor)
  })

  it('rejects anything else', () => {
    expect(() => parseTimelineCursor('x')).toThrow()
    expect(() =>
      parseTimelineCursor({ ...initialTimelineCursor(), replies: null }),
    ).toThrow()
    expect(() =>
      parseTimelineCursor({
        ...initialTimelineCursor(),
        reports: { after: 1, done: false },
      }),
    ).toThrow()
    expect(() =>
      parseTimelineCursor({
        ...initialTimelineCursor(),
        feedbacks: { after: null, done: 'no' },
      }),
    ).toThrow()
  })
})

describe('sortRateTasks', () => {
  it("puts replies on the user's reports first, keeping order within each group", () => {
    const sorted = sortRateTasks([
      rate('a'),
      rate('b', 'reported'),
      rate('c'),
      rate('d', 'reported'),
    ])
    expect(ids(sorted)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('mergeRatePool', () => {
  it('appends new messages only', () => {
    const merged = mergeRatePool(
      [rate('a'), rate('b')],
      [rate('b', 'reported'), rate('c'), rate('c')],
    )
    expect(ids(merged)).toEqual(['a', 'b', 'c'])
    expect(merged[1]?.reason).toBe('needs-rating')
  })
})

describe('composeTaskSlots', () => {
  it('lays out two ratings per writing card, capped at 4 and 2', () => {
    const slots = composeTaskSlots({
      rate: ['1', '2', '3', '4', '5'].map((id) => rate(id)),
      write: ['w1', 'w2', 'w3'].map(write),
    })
    expect(slots).toEqual([
      [rk('1')],
      [rk('2')],
      ['write:w1'],
      [rk('3')],
      [rk('4')],
      ['write:w2'],
    ])
  })

  it('keeps going with what is left when one kind runs out', () => {
    expect(
      composeTaskSlots({
        rate: [rate('1')],
        write: [write('w1'), write('w2')],
      }),
    ).toEqual([[rk('1')], ['write:w1'], ['write:w2']])
    expect(composeTaskSlots({ rate: [], write: [] })).toEqual([])
  })
})

describe('task slots after votes', () => {
  const pool = {
    rate: ['1', '2', '3', '4', '5', '6'].map((id) => rate(id)),
    write: [write('w1')],
    rateAfter: 'next' as string | null,
  }

  it('puts the next candidate directly under the rated card, moving nothing else', () => {
    let state = initTaskSlots(pool)
    expect(state.slots).toEqual([
      [rk('1')],
      [rk('2')],
      ['write:w1'],
      [rk('3')],
      [rk('4')],
    ])
    state = recordVote(state, rk('2'), 'UPVOTE')
    expect(state.slots[1]).toEqual([rk('2'), rk('5')])
    expect(state.voted[rk('2')]).toEqual({ vote: 'UPVOTE', next: 'added' })
    // Rate the new card too: the next one goes under it.
    state = recordVote(state, rk('5'), 'DOWNVOTE')
    expect(state.slots[1]).toEqual([rk('2'), rk('5'), rk('6')])
    expect(state.slots[0]).toEqual([rk('1')])
    expect(unshownRateTasks(state)).toEqual([])
  })

  it('waits for more candidates while the list can continue, then fills in vote order', () => {
    let state = initTaskSlots({ ...pool, rate: pool.rate.slice(0, 4) })
    state = recordVote(state, rk('1'), 'UPVOTE')
    state = recordVote(state, rk('3'), 'UPVOTE')
    expect(state.voted[rk('1')]?.next).toBe('pending')
    expect(state.waiting).toEqual([rk('1'), rk('3')])

    // A late response for another cursor is ignored.
    expect(
      addRateTasks(state, 'stale', { rate: [rate('9')], rateAfter: null }),
    ).toBe(state)

    state = addRateTasks(state, 'next', {
      rate: [rate('2'), rate('7')], // '2' is already in the pool
      rateAfter: null,
    })
    expect(state.slots[0]).toEqual([rk('1'), rk('7')])
    expect(state.voted[rk('1')]?.next).toBe('added')
    // Nothing left and no more pages: the second one says so.
    expect(state.slots[3]).toEqual([rk('3')])
    expect(state.voted[rk('3')]?.next).toBe('exhausted')
    expect(state.waiting).toEqual([])
  })

  it('says there is nothing left right away when the pool is exhausted', () => {
    let state = initTaskSlots({ rate: [rate('1')], write: [], rateAfter: null })
    state = recordVote(state, rk('1'), 'UPVOTE')
    expect(state.voted[rk('1')]?.next).toBe('exhausted')
    expect(recordVote(state, rk('1'), 'DOWNVOTE')).toBe(state)
  })

  it('keeps every card and the gathered pool on a refetch, adding only new candidates', () => {
    // The verifier's case: votes, a second page of candidates, then a refetch of page 1.
    let state = initTaskSlots({
      rate: ['a', 'b', 'c', 'd', 'e'].map((id) => rate(id)),
      write: [write('w1'), write('w2'), write('w3')],
      rateAfter: 'C1',
    })
    state = recordVote(state, rk('a'), 'UPVOTE') // e goes under a
    state = recordVote(state, rk('b'), 'UPVOTE') // waits for page 2
    state = addRateTasks(state, 'C1', {
      rate: [rate('e'), rate('f'), rate('g')],
      rateAfter: 'C2',
    })
    expect(state.slots[1]).toEqual([rk('b'), rk('f')])
    const before = state.slots

    state = syncTaskSlots(state, {
      // a and b were rated, f came from page 2: none of them is in the refetched page 1.
      rate: ['c', 'd', 'e', 'x'].map((id) => rate(id)),
      write: [write('w1'), write('w4')],
      rateAfter: 'C1',
    })
    expect(state.slots).toEqual(before)
    expect(ids(state.rate)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'x'])
    expect(ids(state.write)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(state.rateAfter).toBe('C2')
    expect(state.voted[rk('b')]?.next).toBe('added')
  })
})

describe('interleave', () => {
  const slotOf = (...articleIds: Array<string>) => articleIds.map(write)
  const shape = (items: ReturnType<typeof interleave>) =>
    items.map((i) => (i.type === 'slot' ? ids(i.tasks).join('+') : i.entry.id))

  it('puts a slot first, then one after every 3 entries, and keeps leftovers', () => {
    const entries = ['1', '2', '3', '4'].map((id) =>
      report(id, '2026-01-01T00:00:00Z'),
    )
    const items = interleave(entries, [
      slotOf('x', 'x2'),
      slotOf('y'),
      [],
      slotOf('z'),
    ])
    expect(shape(items)).toEqual(['x+x2', '1', '2', '3', 'y', '4', 'z'])
    expect(items[0]).toMatchObject({ type: 'slot', key: 'write:x' })
  })

  it('shows only entries when there is no slot', () => {
    const items = interleave([report('1', '2026-01-01T00:00:00Z')], [])
    expect(items).toHaveLength(1)
  })
})
