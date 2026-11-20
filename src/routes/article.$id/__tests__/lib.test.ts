import { describe, expect, it } from 'vitest'

import {
  categoryVoteShares,
  formatReportedDate,
  getQuickNavItems,
  isCategoryDisputed,
  linkifyText,
  replyAnchorId,
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

describe('linkifyText', () => {
  it('turns URLs into links and keeps the text around them', () => {
    expect(linkifyText('看這個 https://example.com/a?b=1 好可怕')).toEqual([
      { type: 'text', text: '看這個 ' },
      {
        type: 'link',
        text: 'https://example.com/a?b=1',
        href: 'https://example.com/a?b=1',
      },
      { type: 'text', text: ' 好可怕' },
    ])
  })

  it('leaves sentence punctuation out of the link', () => {
    expect(linkifyText('請看 https://example.com/a。')).toEqual([
      { type: 'text', text: '請看 ' },
      {
        type: 'link',
        text: 'https://example.com/a',
        href: 'https://example.com/a',
      },
      { type: 'text', text: '。' },
    ])
  })

  it('ends the link at full-width punctuation, even with text right after', () => {
    expect(linkifyText('詳見 https://example.com/a?id=1。請轉發！')).toEqual([
      { type: 'text', text: '詳見 ' },
      {
        type: 'link',
        text: 'https://example.com/a?id=1',
        href: 'https://example.com/a?id=1',
      },
      { type: 'text', text: '。請轉發！' },
    ])
  })

  it('returns plain text when there is no URL', () => {
    expect(linkifyText('沒有連結')).toEqual([
      { type: 'text', text: '沒有連結' },
    ])
  })

  it('does not link a bare scheme', () => {
    expect(linkifyText('https://')).toEqual([
      { type: 'text', text: 'https://' },
    ])
  })
})

describe('isCategoryDisputed', () => {
  it('is true only when disagreements outnumber agreements', () => {
    expect(
      isCategoryDisputed({
        positiveFeedbackCount: 1,
        negativeFeedbackCount: 2,
      }),
    ).toBe(true)
    expect(
      isCategoryDisputed({
        positiveFeedbackCount: 2,
        negativeFeedbackCount: 2,
      }),
    ).toBe(false)
    expect(isCategoryDisputed({})).toBe(false)
  })
})

describe('categoryVoteShares', () => {
  it('is null before anyone votes', () => {
    expect(categoryVoteShares({ positiveFeedbackCount: 0 })).toBeNull()
  })

  it('rounds each share down, as rumors-site does', () => {
    expect(
      categoryVoteShares({
        positiveFeedbackCount: 2,
        negativeFeedbackCount: 1,
      }),
    ).toEqual({ agree: 66, disagree: 33 })
  })
})

describe('formatReportedDate', () => {
  it('formats the date in Taiwan time', () => {
    expect(formatReportedDate('2026-11-16T17:30:00Z')).toBe('2026/11/17')
  })

  it('is null for a missing or broken date', () => {
    expect(formatReportedDate(null)).toBeNull()
    expect(formatReportedDate('nope')).toBeNull()
  })
})
