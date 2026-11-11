import { useEffect, useMemo, useState } from 'react'

import type {
  ContributionTask,
  ContributionTasksData,
  FeedbackVoteValue,
  RateTask,
  TaskSlotsState,
} from '@/lib/contributions'
import {
  addRateTasks,
  initTaskSlots,
  mergeRatePool,
  recordVote,
  syncTaskSlots,
  taskKey,
  unshownRateTasks,
} from '@/lib/contributions'

/** Fetch more rating candidates when fewer than this many are left unshown. */
const LOW_WATER = 3
/** Stop asking after this many pages in a row brought nothing new. */
const MAX_EMPTY_PAGES = 3

type SlotsHookState = TaskSlotsState & {
  /** The tasks data the slots were last synced with. */
  source: ContributionTasksData
  /** Pages in a row that brought no new candidate. */
  emptyPages: number
}

type MoreRateTasks = (
  after: string,
) => Promise<Pick<ContributionTasksData, 'rate' | 'rateAfter'> | null>

/**
 * The task cards' layout on 我的貢獻, kept in the page so cards never reshuffle: slots are laid
 * out once from the tasks query, a rated card stays (collapsed) with the next candidate added
 * right under it, and the pool of rating candidates is topped up through `loadMoreRate` (the
 * route passes a function that reads the query cache; this hook doesn't know about the server).
 */
export function useTaskSlots(
  tasks: ContributionTasksData | null | undefined,
  loadMoreRate: MoreRateTasks,
) {
  const [state, setState] = useState<SlotsHookState | null>(null)
  const [loadingFrom, setLoadingFrom] = useState<string | null>(null)

  // New tasks data (first load, or a refetch): lay out once, then only sync.
  if (tasks && tasks !== state?.source) {
    setState((s) => ({
      ...(s ? syncTaskSlots(s, tasks) : initTaskSlots(tasks)),
      source: tasks,
      emptyPages: 0,
    }))
  }

  const rateAfter = state?.rateAfter ?? null
  const unshown = state ? unshownRateTasks(state).length : 0
  useEffect(() => {
    if (!rateAfter || loadingFrom || unshown >= LOW_WATER) return
    const from = rateAfter
    setLoadingFrom(from)
    loadMoreRate(from)
      .then(
        (more) => more ?? { rate: [], rateAfter: null },
        // Can't reach more candidates now: stop asking, the cards shown keep working.
        () => ({ rate: [] as Array<RateTask>, rateAfter: null }),
      )
      .then((more) => {
        setState((s) => {
          if (!s || s.rateAfter !== from) return s
          const fresh = mergeRatePool(s.rate, more.rate).length > s.rate.length
          const emptyPages = fresh ? 0 : s.emptyPages + 1
          return {
            ...addRateTasks(s, from, {
              rate: more.rate,
              rateAfter: emptyPages >= MAX_EMPTY_PAGES ? null : more.rateAfter,
            }),
            source: s.source,
            emptyPages,
          }
        })
      })
      .finally(() => setLoadingFrom(null))
  }, [rateAfter, loadingFrom, unshown, loadMoreRate])

  const slots = useMemo(() => {
    if (!state) return []
    const byKey = new Map<string, ContributionTask>(
      [...state.rate, ...state.write].map((t) => [taskKey(t), t]),
    )
    return state.slots.map((slot) =>
      slot.flatMap((key) => {
        const task = byKey.get(key)
        return task ? [task] : []
      }),
    )
  }, [state])

  const onVoted = (task: ContributionTask, vote: FeedbackVoteValue) =>
    setState((s) => (s ? { ...s, ...recordVote(s, taskKey(task), vote) } : s))

  return { slots, voted: state?.voted ?? {}, onVoted }
}
