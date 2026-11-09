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

  it('stops a URL at full-width punctuation and CJK text', () => {
    expect(links('詳見https://example.com/a，謝謝')).toEqual([
      'https://example.com/a',
    ])
    expect(links('https://example.com/a謝謝')).toEqual([
      'https://example.com/a',
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
