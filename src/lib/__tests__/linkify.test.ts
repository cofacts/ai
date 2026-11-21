import { describe, expect, it } from 'vitest'

import { splitLinks } from '../linkify'

const links = (text: string) =>
  splitLinks(text)
    .filter((p) => p.type === 'link')
    .map((p) => p.value)

describe('splitLinks', () => {
  it('keeps plain text as one part', () => {
    expect(splitLinks('沒有連結')).toEqual([
      { type: 'text', value: '沒有連結' },
    ])
  })

  it('stops a URL at full-width punctuation', () => {
    expect(links('詳見https://example.com/a，謝謝')).toEqual([
      'https://example.com/a',
    ])
    expect(links('見https://example.com/a。後')).toEqual([
      'https://example.com/a',
    ])
  })

  it('keeps CJK characters in the URL path', () => {
    expect(links('https://zh.wikipedia.org/wiki/蔡英文')).toEqual([
      'https://zh.wikipedia.org/wiki/蔡英文',
    ])
    expect(
      links(
        '詳見https://tw.news.yahoo.com/網路借貸變詐騙共犯-帳戶變人頭戶挨告-123513493.html，謝謝',
      ),
    ).toEqual([
      'https://tw.news.yahoo.com/網路借貸變詐騙共犯-帳戶變人頭戶挨告-123513493.html',
    ])
  })

  it('leaves sentence punctuation out of the URL', () => {
    expect(links('see https://example.com/a.')).toEqual([
      'https://example.com/a',
    ])
    expect(links('(https://example.com/a)')).toEqual(['https://example.com/a'])
  })

  it('keeps a paren that balances one inside the URL', () => {
    expect(links('https://en.wikipedia.org/wiki/A_(b)')).toEqual([
      'https://en.wikipedia.org/wiki/A_(b)',
    ])
  })

  it('loses no characters', () => {
    const text = '前https://a.com/x，中 https://b.org。後'
    expect(
      splitLinks(text)
        .map((p) => p.value)
        .join(''),
    ).toBe(text)
  })
})
