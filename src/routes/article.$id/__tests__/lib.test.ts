import { describe, expect, it } from 'vitest'

import { getQuickNavItems, replyAnchorId } from '../-lib'

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
