import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getReportOutcomeArticle } from '../$articleId'
import { cofactsExec } from '@/server/cofacts.server'

vi.mock('@tanstack/react-start', () => import('@/test/createServerFnMock'))
vi.mock('@/server/cofacts.server', () => ({ cofactsExec: vi.fn() }))

const mockedExec = vi.mocked(cofactsExec)

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.COFACTS_API_URL = 'https://dev-api.cofacts.tw'
})

afterEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv }
})

describe('getReportOutcomeArticle', () => {
  test('returns the article with a link on the matching site', async () => {
    mockedExec.mockResolvedValueOnce({ GetArticle: { id: 'a1' } })

    const outcome = await getReportOutcomeArticle({ data: 'a1' })

    expect(outcome?.article.id).toBe('a1')
    // dev-api.cofacts.tw -> dev.cofacts.tw, not cofacts.tw, which would 404.
    expect(outcome?.articleUrl).toBe('https://dev.cofacts.tw/article/a1')
  })

  test('returns null when the article is gone', async () => {
    mockedExec.mockResolvedValueOnce({ GetArticle: null })
    expect(await getReportOutcomeArticle({ data: 'nope' })).toBeNull()
  })
})
