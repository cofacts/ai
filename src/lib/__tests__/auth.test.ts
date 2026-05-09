import { describe, expect, test } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { clearUserScopedCache } from '../auth'

describe('clearUserScopedCache', () => {
  test('removes me / sessions / chat caches so an anonymous viewer cannot read prior user data', () => {
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
    queryClient.setQueryData(['chat', 's1'], { messages: ['secret-1'] })
    queryClient.setQueryData(['chat', 's2'], { messages: ['secret-2'] })

    clearUserScopedCache(queryClient)

    expect(queryClient.getQueryData(['me'])).toBeNull()
    expect(queryClient.getQueryData(['sessions'])).toBeUndefined()
    expect(queryClient.getQueryData(['chat', 's1'])).toBeUndefined()
    expect(queryClient.getQueryData(['chat', 's2'])).toBeUndefined()
  })

  test('leaves unrelated caches untouched', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['something-else'], { keep: true })

    clearUserScopedCache(queryClient)

    expect(queryClient.getQueryData(['something-else'])).toEqual({ keep: true })
  })
})
