import { describe, expect, test } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { clearUserScopedCache } from '../auth'
import { chatCacheKey } from '../chatCache'

describe('clearUserScopedCache', () => {
  test('removes me / sessions / chat / feedback caches so an anonymous viewer cannot read prior user data', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity } },
    })
    queryClient.setQueryData(['me'], {
      id: 'user-1',
      name: 'Alice',
      avatarUrl: null,
      avatarType: null,
      avatarData: null,
    })
    queryClient.setQueryData(
      ['sessions'],
      [{ id: 's1', name: 'old', lastUpdateTime: 0 }],
    )
    queryClient.setQueryData(chatCacheKey('s1'), { messages: ['secret-1'] })
    queryClient.setQueryData(chatCacheKey('s2'), { messages: ['secret-2'] })
    queryClient.setQueryData(['feedback', 'trace-1', 'user-1'], {
      value: 1,
      comment: 'nice',
    })
    const contributionKeys = [
      ['GetContributionSummary'],
      ['GetContributionTimeline'],
      ['GetContributionTasks'],
      ['GetMoreRateTasks', { after: 'c1' }],
    ]
    for (const key of contributionKeys) queryClient.setQueryData(key, {})

    clearUserScopedCache(queryClient)

    expect(queryClient.getQueryData(['me'])).toBeNull()
    expect(queryClient.getQueryData(['sessions'])).toBeUndefined()
    expect(queryClient.getQueryData(chatCacheKey('s1'))).toBeUndefined()
    expect(queryClient.getQueryData(chatCacheKey('s2'))).toBeUndefined()
    expect(
      queryClient.getQueryData(['feedback', 'trace-1', 'user-1']),
    ).toBeUndefined()
    for (const key of contributionKeys) {
      expect(queryClient.getQueryData(key)).toBeUndefined()
    }
  })

  test('leaves unrelated caches untouched', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['something-else'], { keep: true })

    clearUserScopedCache(queryClient)

    expect(queryClient.getQueryData(['something-else'])).toEqual({ keep: true })
  })
})
