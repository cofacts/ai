import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { print } from 'graphql'

import {
  createArticleReport,
  requestFactCheck,
  sameLink,
  searchSuspiciousMessages,
} from '../check'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'
import { cofactsExec } from '@/server/cofacts.server'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'

vi.mock('@tanstack/react-start', () => import('@/test/createServerFnMock'))
vi.mock('@/server/cofacts.server', () => ({ cofactsExec: vi.fn() }))
vi.mock('@/server/adkUser', () => ({ resolveAdkUserIdOrThrow: vi.fn() }))

const mockedExec = vi.mocked(cofactsExec)
const mockedAuth = vi.mocked(resolveAdkUserIdOrThrow)

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.COFACTS_API_URL = 'https://dev-api.cofacts.tw'
  mockedAuth.mockResolvedValue('user-1')
})

afterEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv }
})

/** The document and variables the handler handed to cofactsExec. */
function lastCall(): { query: string; variables: Record<string, unknown> } {
  const call = mockedExec.mock.calls.at(-1)
  if (!call) throw new Error('cofactsExec was never called')
  return {
    query: print(call[0]),
    variables: (call[1] ?? {}) as Record<string, unknown>,
  }
}

describe('searchSuspiciousMessages', () => {
  test('demands a near-exact match, because the query is always a link', async () => {
    // Measured on dev: at rumors-api's prose default this query returns 54
    // unrelated Facebook posts scoring an identical 225.5, because every share
    // link shares every token but the id. At 90% it returns the one right
    // article, or none.
    mockedExec.mockResolvedValueOnce({ ListArticles: { edges: [] } })

    await searchSuspiciousMessages({
      data: ' https://www.facebook.com/share/p/1HSNRpimmH/\n',
    })

    const { variables } = lastCall()
    expect(variables).toEqual({
      like: 'https://www.facebook.com/share/p/1HSNRpimmH/',
      first: 5,
      minimumShouldMatch: '90%',
    })
  })

  test('gives each candidate the page where a human can read it', async () => {
    // Picking a candidate is a +1, so the reporter has to be able to look first.
    mockedExec.mockResolvedValueOnce({
      ListArticles: { edges: [{ node: { id: 'a1', text: 'foo' } }] },
    })

    const [candidate] = await searchSuspiciousMessages({ data: 'foo' })

    // dev-api.cofacts.tw -> dev.cofacts.tw, not cofacts.tw, which would 404.
    expect(candidate?.articleUrl).toBe('https://dev.cofacts.tw/article/a1')
  })

  test('puts the identical message first, and only an exact match counts', async () => {
    // Search ranks by relevance score; the link's own article can come later.
    const link = 'https://www.facebook.com/somepage/posts/987654321012345/'
    mockedExec.mockResolvedValueOnce({
      ListArticles: {
        edges: [
          // One character off: a different post, not the same message.
          { node: { id: 'near', text: link.replace('345/', '346/') } },
          { node: { id: 'image', text: null } },
          // Whitespace around and inside does not make it different.
          { node: { id: 'same', text: ` ${link}\n` } },
        ],
      },
    })

    const candidates = await searchSuspiciousMessages({ data: link })

    // Identical first; the rest keep rumors-api's order.
    expect(candidates.map((c) => [c.node.id, c.identical])).toEqual([
      ['same', true],
      ['near', false],
      ['image', false],
    ])
  })

  test('ignores the case of the scheme and host, not of the rest', async () => {
    // The form accepts `Https://`; scheme and host are case-insensitive, but a
    // share id is not.
    const link = 'https://www.facebook.com/share/p/1HSNRpimmH/'
    mockedExec.mockResolvedValueOnce({
      ListArticles: {
        edges: [
          { node: { id: 'path-case', text: link.replace('1HSN', '1hsn') } },
          { node: { id: 'same', text: link } },
        ],
      },
    })

    const candidates = await searchSuspiciousMessages({
      data: 'Https://WWW.Facebook.COM/share/p/1HSNRpimmH/',
    })

    expect(candidates.map((c) => [c.node.id, c.identical])).toEqual([
      ['same', true],
      ['path-case', false],
    ])
  })

  test('survives a null connection', async () => {
    mockedExec.mockResolvedValueOnce({ ListArticles: null })
    expect(await searchSuspiciousMessages({ data: 'foo' })).toEqual([])
  })
})

describe('requestFactCheck', () => {
  test('sends the reason trimmed, and null rather than an empty one', async () => {
    mockedExec.mockResolvedValue({ CreateOrUpdateReplyRequest: { id: 'a1' } })

    await requestFactCheck({
      data: { articleId: 'a1', reason: '  來源看起來怪怪的  ' },
    })
    expect(lastCall().variables).toEqual({
      articleId: 'a1',
      reason: '來源看起來怪怪的',
    })

    await requestFactCheck({ data: { articleId: 'a1', reason: '   ' } })
    expect(lastCall().variables.reason).toBeNull()
  })

  test('never reaches the API without a signed-in user', async () => {
    mockedAuth.mockRejectedValueOnce(new Error(AUTH_EXPIRED_MESSAGE))

    await expect(
      requestFactCheck({ data: { articleId: 'a1' } }),
    ).rejects.toThrowError(AUTH_EXPIRED_MESSAGE)
    expect(mockedExec).not.toHaveBeenCalled()
  })

  test('does not report success for a missing article', async () => {
    mockedExec.mockResolvedValueOnce({ CreateOrUpdateReplyRequest: null })
    await expect(
      requestFactCheck({ data: { articleId: 'gone' } }),
    ).rejects.toThrowError(/not found/i)
  })

  test('rejects a missing article id before any request', async () => {
    await expect(
      requestFactCheck({ data: { articleId: '' } }),
    ).rejects.toThrowError(/articleId/)
    expect(mockedExec).not.toHaveBeenCalled()
  })
})

describe('createArticleReport', () => {
  test('files the link as both the article text and its reference', async () => {
    mockedExec.mockResolvedValueOnce({ CreateArticle: { id: 'new1' } })

    const result = await createArticleReport({
      data: { url: ' https://example.com/a ', reason: '  看起來像業配 ' },
    })

    expect(result).toEqual({ articleId: 'new1' })
    expect(lastCall().variables).toEqual({
      text: 'https://example.com/a',
      // URL, never LINE: this entry point only takes a link, so it never has
      // to mislabel one.
      reference: { type: 'URL', permalink: 'https://example.com/a' },
      reason: '看起來像業配',
    })
  })

  test('sends null rather than an empty reason', async () => {
    mockedExec.mockResolvedValueOnce({ CreateArticle: { id: 'new1' } })
    await createArticleReport({
      data: { url: 'https://example.com/a', reason: ' ' },
    })
    expect(lastCall().variables.reason).toBeNull()
  })

  test('never reaches the API without a signed-in user', async () => {
    mockedAuth.mockRejectedValueOnce(new Error(AUTH_EXPIRED_MESSAGE))

    await expect(
      createArticleReport({ data: { url: 'https://example.com/a' } }),
    ).rejects.toThrowError(AUTH_EXPIRED_MESSAGE)
    expect(mockedExec).not.toHaveBeenCalled()
  })

  test('does not report success when no id comes back', async () => {
    mockedExec.mockResolvedValueOnce({ CreateArticle: null })
    await expect(
      createArticleReport({ data: { url: 'https://example.com/a' } }),
    ).rejects.toThrowError(/article id/i)
  })
})

describe('sameLink', () => {
  test.each([
    ['Https://WWW.Example.COM/A?B=C', 'https://www.example.com/A?B=C'],
    [' https://example.com/a \n', 'https://example.com/a'],
    // Only the host part of the authority: userinfo is case-sensitive.
    ['HTTP://User:Pass@Example.COM/x', 'http://User:Pass@example.com/x'],
    // Not a link: whitespace removed, nothing else touched.
    ['Not A Link', 'NotALink'],
  ])('%j → %j', (input, expected) => {
    expect(sameLink(input)).toBe(expected)
  })
})
