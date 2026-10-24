import { describe, expect, test } from 'vitest'
import { deriveChatError } from '../useChat'
import { SESSION_NOT_FOUND_MESSAGE } from '@/lib/sessionNotFound'

// useChat itself is a hook (needs a QueryClientProvider + rendering, which
// this repo's Vite/Vitest setup does not yet support — see the PR that
// introduced deriveChatError). This exercises the exact error-merging logic
// the hook calls, isolated from React.
describe('deriveChatError', () => {
  test('passes through a normal ADK communication error', () => {
    const result = deriveChatError(null, new Error('boom'))
    expect(result).toEqual({ error: 'boom', sessionNotFound: false })
  })

  test('reports sessionNotFound and suppresses the generic error string on a 404', () => {
    const result = deriveChatError(null, new Error(SESSION_NOT_FOUND_MESSAGE))
    expect(result).toEqual({ error: null, sessionNotFound: true })
  })

  test('a chat-cache error (e.g. mid-stream failure) still wins even if the session query is fine', () => {
    const result = deriveChatError('stream dropped', null)
    expect(result).toEqual({ error: 'stream dropped', sessionNotFound: false })
  })

  test('non-Error, non-null queryError values are treated as no error', () => {
    const result = deriveChatError(null, 'some string')
    expect(result).toEqual({ error: null, sessionNotFound: false })
  })
})
