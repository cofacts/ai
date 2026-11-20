import { describe, expect, it } from 'vitest'

import {
  getArticleHead,
  getQuickNavItems,
  replyAnchorId,
  summarizeText,
} from '../-lib'

describe('getQuickNavItems', () => {
  it('lists AI 自動分析 only while there is no reply', () => {
    expect(getQuickNavItems({ replyCount: 0 }).map((item) => item.id)).toEqual([
      'original',
      'replies',
      'ai-analysis',
      'similar',
    ])
    expect(getQuickNavItems({ replyCount: 2 }).map((item) => item.id)).toEqual([
      'original',
      'replies',
      'similar',
    ])
  })

  it('counts the replies in the 查核回應 entry', () => {
    expect(
      getQuickNavItems({ replyCount: 2 }).find((item) => item.id === 'replies')
        ?.label,
    ).toBe('查核回應 (2)')
  })

  it('lists 相似可疑訊息與組合 only in the mobile row', () => {
    expect(
      getQuickNavItems({ replyCount: 2 })
        .filter((item) => item.mobileOnly)
        .map((item) => item.id),
    ).toEqual(['similar'])
  })
})

describe('replyAnchorId', () => {
  it('is the #reply-:replyId anchor', () => {
    expect(replyAnchorId('abc')).toBe('reply-abc')
  })
})

describe('getArticleHead', () => {
  const url = 'https://example.test/article/abc'
  const imageUrl = 'https://example.test/og-image.png'
  const content = (head: ReturnType<typeof getArticleHead>, key: string) =>
    head.meta.find(
      (tag) =>
        ('property' in tag && tag.property === key) ||
        ('name' in tag && tag.name === key),
    )

  it('describes the message for share previews', () => {
    const head = getArticleHead({
      title: '喝溫開水可以預防新冠肺炎',
      description: '喝溫開水可以預防新冠肺炎，請轉發給家人！',
      url,
      imageUrl,
    })
    expect(head.meta[0]).toEqual({
      title: '喝溫開水可以預防新冠肺炎 | Cofacts 真的假的',
    })
    expect(content(head, 'og:title')).toMatchObject({
      content: '喝溫開水可以預防新冠肺炎',
    })
    expect(content(head, 'og:description')).toMatchObject({
      content: '喝溫開水可以預防新冠肺炎，請轉發給家人！',
    })
    expect(content(head, 'og:type')).toMatchObject({ content: 'article' })
    expect(content(head, 'og:site_name')).toMatchObject({
      content: 'Cofacts 真的假的',
    })
    expect(content(head, 'og:url')).toMatchObject({ content: url })
    expect(content(head, 'og:image')).toMatchObject({ content: imageUrl })
    expect(content(head, 'og:image:width')).toMatchObject({ content: '702' })
    expect(content(head, 'og:image:height')).toMatchObject({ content: '484' })
    expect(content(head, 'twitter:card')).toMatchObject({
      content: 'summary_large_image',
    })
    expect(head.links).toEqual([{ rel: 'canonical', href: url }])
  })

  it('falls back to 可疑訊息 and leaves out the description without text', () => {
    const head = getArticleHead({
      title: '',
      description: '',
      url,
      imageUrl,
    })
    expect(content(head, 'og:title')).toMatchObject({ content: '可疑訊息' })
    expect(content(head, 'description')).toBeUndefined()
    expect(content(head, 'og:description')).toBeUndefined()
  })
})

describe('summarizeText', () => {
  it("puts an OCR'd message on one line", () => {
    expect(summarizeText('f\nfacebook\n工作證\n  WORK CARD ', 60)).toBe(
      'f facebook 工作證 WORK CARD',
    )
  })

  it('cuts by character, not by UTF-16 unit', () => {
    expect(summarizeText('😀😀😀', 2)).toBe('😀😀')
  })

  it('is empty without text', () => {
    expect(summarizeText(null, 60)).toBe('')
  })
})
