import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ogImageVersion } from '../-lib'
import { OG_CACHE_CONTROL, handleOgImage } from '../og[.]png'
import { cofactsExec } from '@/server/cofacts.server'
import { renderArticleCard } from '@/server/og/articleCard.server'

vi.mock('@/server/cofacts.server', () => ({ cofactsExec: vi.fn() }))
vi.mock('@/server/og/articleCard.server', () => ({
  renderArticleCard: vi.fn(),
}))

const mockedExec = vi.mocked(cofactsExec)
const mockedRender = vi.mocked(renderArticleCard)

const ARTICLE = {
  id: 'abc',
  text: '喝溫開水可以預防新冠肺炎',
  articleType: 'TEXT',
  status: 'NORMAL',
  replyRequestCount: 3,
  thumbnailUrl: null,
  articleReplies: [{ replyType: 'RUMOR' }],
}
const VERSION = ogImageVersion({
  status: 'NORMAL',
  replyTypes: ['RUMOR'],
  replyRequestCount: 3,
})

function get(query = '', headers: Record<string, string> = {}) {
  return handleOgImage({
    request: new Request(`https://example.test/article/abc/og.png${query}`, {
      headers,
    }),
    params: { id: 'abc' },
  })
}

describe('handleOgImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedExec.mockResolvedValue({ GetArticle: ARTICLE } as never)
    mockedRender.mockResolvedValue(Buffer.from('png') as never)
  })

  test('asks rumors-api anonymously', async () => {
    await get()
    expect(mockedExec).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'abc' },
      { anonymous: true },
    )
  })

  test('caches the current ?v= for a year, with the version as ETag', async () => {
    const res = await get(`?v=${VERSION}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe(OG_CACHE_CONTROL.versioned)
    expect(res.headers.get('ETag')).toBe(`"${VERSION}"`)
  })

  test('caches a URL without ?v=, or with an old one, for a short time', async () => {
    expect((await get()).headers.get('Cache-Control')).toBe(
      OG_CACHE_CONTROL.unversioned,
    )
    expect((await get('?v=old')).headers.get('Cache-Control')).toBe(
      OG_CACHE_CONTROL.unversioned,
    )
  })

  test('answers a matching If-None-Match with 304, without rendering', async () => {
    const res = await get(`?v=${VERSION}`, { 'If-None-Match': `"${VERSION}"` })
    expect(res.status).toBe(304)
    expect(res.headers.get('Cache-Control')).toBe(OG_CACHE_CONTROL.versioned)
    expect(mockedRender).not.toHaveBeenCalled()
  })

  test('draws the verdict and the report count', async () => {
    await get()
    expect(mockedRender).toHaveBeenCalledWith({
      text: '喝溫開水可以預防新冠肺炎',
      articleType: 'TEXT',
      imageDataUrl: null,
      verdict: 'RUMOR',
      replyRequestCount: 3,
    })
  })

  test('hides the content of a blocked article', async () => {
    mockedExec.mockResolvedValue({
      GetArticle: { ...ARTICLE, status: 'BLOCKED' },
    } as never)
    await get()
    expect(mockedRender).toHaveBeenCalledWith(
      expect.objectContaining({ text: null, imageDataUrl: null }),
    )
  })

  test('is a short-lived 404 for an unknown article', async () => {
    mockedExec.mockResolvedValue({ GetArticle: null } as never)
    const res = await get()
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe(OG_CACHE_CONTROL.notFound)
  })

  test('is an uncached 503 when rumors-api fails', async () => {
    mockedExec.mockRejectedValue(new Error('down'))
    const res = await get()
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
