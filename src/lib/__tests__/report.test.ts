import { describe, expect, test } from 'vitest'

import { findFirstUrl } from '../report'

describe('findFirstUrl', () => {
  test('finds a bare link', () => {
    expect(findFirstUrl('https://www.facebook.com/share/p/1HSNRpimmH/')).toBe(
      'https://www.facebook.com/share/p/1HSNRpimmH/',
    )
  })

  test('finds a link pasted in among the reporter’s own words', () => {
    // The URL field is forgiving about this: it keeps the link and shows the
    // reporter what will be submitted, rather than rejecting the paste.
    expect(findFirstUrl('我媽傳這個給我 https://example.com/a 說很可怕')).toBe(
      'https://example.com/a',
    )
  })

  test('does not swallow the full stop that ends the sentence', () => {
    expect(findFirstUrl('看看這個 https://example.com/a。')).toBe(
      'https://example.com/a',
    )
    expect(findFirstUrl('see https://example.com/a.')).toBe(
      'https://example.com/a',
    )
  })

  test('keeps a closing bracket that is part of the link', () => {
    expect(findFirstUrl('https://en.wikipedia.org/wiki/Mercury_(planet)')).toBe(
      'https://en.wikipedia.org/wiki/Mercury_(planet)',
    )
    expect(
      findFirstUrl('看這篇 https://en.wikipedia.org/wiki/Mercury_(planet)。'),
    ).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)')
  })

  test('drops a closing bracket that belongs to the surrounding prose', () => {
    expect(findFirstUrl('(see https://x.com/a)')).toBe('https://x.com/a')
    expect(findFirstUrl('（來源：https://x.com/a）')).toBe('https://x.com/a')
    expect(findFirstUrl('「https://x.com/a」')).toBe('https://x.com/a')
    expect(
      findFirstUrl('(see https://en.wikipedia.org/wiki/Mercury_(planet)).'),
    ).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)')
  })

  test('returns null for text with no link, which the form must refuse', () => {
    expect(findFirstUrl('長輩群組傳的，說吃這個可以防癌')).toBeNull()
    expect(findFirstUrl('')).toBeNull()
  })

  test('ignores a non-http scheme', () => {
    expect(findFirstUrl('javascript:alert(1)')).toBeNull()
  })
})
