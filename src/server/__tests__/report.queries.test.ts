import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { print } from 'graphql'

import { resolveAdkUserIdOrThrow } from '../adkUser'
import {
  fetchReportOutcome,
  fileArticleReport,
  findSimilarReports,
  recordFactCheckRequest,
} from '../report.queries'
import { cofactsExec } from '@/lib/cofactsExec'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'

vi.mock('@/lib/cofactsExec', () => ({ cofactsExec: vi.fn() }))
vi.mock('../adkUser', () => ({ resolveAdkUserIdOrThrow: vi.fn() }))

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

/** The document and variables the code under test handed to cofactsExec. */
function lastCall(): { query: string; variables: Record<string, unknown> } {
  const call = mockedExec.mock.calls.at(-1)
  if (!call) throw new Error('cofactsExec was never called')
  return {
    query: print(call[0]),
    variables: (call[1] ?? {}) as Record<string, unknown>,
  }
}

describe('findSimilarReports', () => {
  test('demands a near-exact match when the submission is only a link', async () => {
    // Measured on dev: at rumors-api's prose default this query returns 54
    // unrelated Facebook posts scoring an identical 225.5, because every share
    // link shares every token but the id. At 90% it returns the one right
    // article, or none.
    mockedExec.mockResolvedValueOnce({
      ListArticles: { totalCount: 0, edges: [] },
    })

    await findSimilarReports('https://www.facebook.com/share/p/1HSNRpimmH/')

    const { variables } = lastCall()
    expect(variables.minimumShouldMatch).toBe('90%')
    expect(variables.like).toBe('https://www.facebook.com/share/p/1HSNRpimmH/')
    expect(variables.first).toBe(5)
  })

  test('leaves prose to the default, which was tuned for prose', async () => {
    mockedExec.mockResolvedValueOnce({
      ListArticles: { totalCount: 0, edges: [] },
    })

    await findSimilarReports('後座沒綁安全帶罰六千 https://example.com/a')

    expect(lastCall().variables.minimumShouldMatch).toBeNull()
  })

  test('returns the edges with their scores', async () => {
    mockedExec.mockResolvedValueOnce({
      ListArticles: {
        totalCount: 2,
        edges: [
          { score: 12.5, node: { id: 'a1', text: 'foo' } },
          { score: 3.1, node: { id: 'a2', text: 'bar' } },
        ],
      },
    })

    const result = await findSimilarReports('foo')

    expect(result.totalCount).toBe(2)
    expect(result.candidates.map((e) => e.node.id)).toEqual(['a1', 'a2'])
    expect(result.candidates[0]?.score).toBe(12.5)
  })

  test('survives an empty or null connection', async () => {
    mockedExec.mockResolvedValueOnce({ ListArticles: null })
    expect(await findSimilarReports('foo')).toEqual({
      totalCount: 0,
      candidates: [],
    })

    mockedExec.mockResolvedValueOnce({
      ListArticles: { totalCount: 0, edges: [] },
    })
    expect((await findSimilarReports('foo')).candidates).toEqual([])
  })
})

describe('fetchReportOutcome', () => {
  test('returns the article with a link on the matching site', async () => {
    mockedExec.mockResolvedValueOnce({ GetArticle: { id: 'a1', text: 'foo' } })

    const outcome = await fetchReportOutcome('a1')

    expect(outcome?.article.id).toBe('a1')
    // dev-api.cofacts.tw -> dev.cofacts.tw, not cofacts.tw, which would 404.
    expect(outcome?.articleUrl).toBe('https://dev.cofacts.tw/article/a1')
  })

  test('returns null when the article is gone', async () => {
    mockedExec.mockResolvedValueOnce({ GetArticle: null })
    expect(await fetchReportOutcome('nope')).toBeNull()
  })
})

describe('recordFactCheckRequest', () => {
  test('records the request and reports the new count', async () => {
    mockedExec.mockResolvedValueOnce({
      CreateOrUpdateReplyRequest: { id: 'a1', replyRequestCount: 4 },
    })

    const result = await recordFactCheckRequest({
      articleId: 'a1',
      reason: '  來源看起來怪怪的  ',
    })

    expect(result).toEqual({ articleId: 'a1', communityDemandCount: 4 })
    expect(lastCall().variables.reason).toBe('來源看起來怪怪的')
  })

  test('sends null rather than an empty reason', async () => {
    mockedExec.mockResolvedValueOnce({
      CreateOrUpdateReplyRequest: { id: 'a1', replyRequestCount: 1 },
    })
    await recordFactCheckRequest({ articleId: 'a1', reason: '   ' })
    expect(lastCall().variables.reason).toBeNull()
  })

  test('never reaches the API without a signed-in user', async () => {
    mockedAuth.mockRejectedValueOnce(new Error(AUTH_EXPIRED_MESSAGE))

    await expect(
      recordFactCheckRequest({ articleId: 'a1' }),
    ).rejects.toThrowError(AUTH_EXPIRED_MESSAGE)
    expect(mockedExec).not.toHaveBeenCalled()
  })

  test('does not report success for a missing article', async () => {
    mockedExec.mockResolvedValueOnce({ CreateOrUpdateReplyRequest: null })
    await expect(
      recordFactCheckRequest({ articleId: 'gone' }),
    ).rejects.toThrowError(/not found/i)
  })
})

describe('fileArticleReport', () => {
  test('files verbatim text with a URL reference', async () => {
    mockedExec.mockResolvedValueOnce({ CreateArticle: { id: 'new1' } })

    const result = await fileArticleReport({
      text: '我媽傳這個 https://example.com/a',
      permalink: 'https://example.com/a',
      reason: '看起來像業配',
    })

    expect(result).toEqual({
      articleId: 'new1',
      articleUrl: 'https://dev.cofacts.tw/article/new1',
    })
    const { variables } = lastCall()
    expect(variables.text).toBe('我媽傳這個 https://example.com/a')
    // URL, never LINE: this entry point only takes messages that came with a
    // link, so it never has to mislabel one.
    expect(variables.reference).toEqual({
      type: 'URL',
      permalink: 'https://example.com/a',
    })
  })

  test('never reaches the API without a signed-in user', async () => {
    mockedAuth.mockRejectedValueOnce(new Error(AUTH_EXPIRED_MESSAGE))

    await expect(
      fileArticleReport({ text: 'x', permalink: 'https://example.com/a' }),
    ).rejects.toThrowError(AUTH_EXPIRED_MESSAGE)
    expect(mockedExec).not.toHaveBeenCalled()
  })

  test('does not report success when no id comes back', async () => {
    mockedExec.mockResolvedValueOnce({ CreateArticle: null })
    await expect(
      fileArticleReport({ text: 'x', permalink: 'https://example.com/a' }),
    ).rejects.toThrowError(/article id/i)
  })
})
