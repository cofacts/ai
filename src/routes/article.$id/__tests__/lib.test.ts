import { describe, expect, it } from 'vitest'

import { getQuickNavItems, replyAnchorId } from '../-lib'

describe('getQuickNavItems', () => {
  it('lists AI 自動分析 only while there is no reply', () => {
    expect(getQuickNavItems({ replyCount: 0 }).map((item) => item.id)).toEqual([
      'replies',
      'ai-analysis',
      'similar',
      'original',
    ])
    expect(getQuickNavItems({ replyCount: 2 }).map((item) => item.id)).toEqual([
      'replies',
      'similar',
      'original',
    ])
  })

  it('counts the replies in the 查核回應 entry', () => {
    expect(getQuickNavItems({ replyCount: 2 })[0]?.label).toBe('查核回應 (2)')
  })
})

describe('replyAnchorId', () => {
  it('is the #reply-:replyId anchor', () => {
    expect(replyAnchorId('abc')).toBe('reply-abc')
  })
})
