import { describe, expect, test } from 'vitest'

import { findFirstUrl, findSharedUrl } from '../report'

// Android's Web Share Target and the iOS shortcut both hand off through the
// query string, and the sending app decides which field the link lands in.

describe('findSharedUrl', () => {
  test('reads the payload Facebook on Android actually sends', () => {
    // Measured on a preview deployment: the link is the whole of `text`, and
    // neither `url` nor `title` is set.
    expect(
      findSharedUrl({ text: 'https://www.facebook.com/share/p/1HSNRpimmH/' }),
    ).toBe('https://www.facebook.com/share/p/1HSNRpimmH/')
  })

  test('reads a link the app put in url instead', () => {
    expect(findSharedUrl({ url: 'https://example.com/a' })).toBe(
      'https://example.com/a',
    )
  })

  test('prefers url when both carry one', () => {
    expect(
      findSharedUrl({ url: 'https://example.com/a', text: 'https://other/b' }),
    ).toBe('https://example.com/a')
  })

  test('digs the link out of a longer shared text', () => {
    expect(
      findSharedUrl({ text: '快看這則 https://example.com/a 太扯了' }),
    ).toBe('https://example.com/a')
  })

  test('returns null when the share carried no link at all', () => {
    expect(
      findSharedUrl({ text: '長輩群組傳的', title: '某某新聞' }),
    ).toBeNull()
    expect(findSharedUrl({})).toBeNull()
    expect(findSharedUrl(undefined)).toBeNull()
  })

  test('ignores a non-http scheme', () => {
    expect(findSharedUrl({ url: 'javascript:alert(1)' })).toBeNull()
  })
})

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
  })

  test('returns null for text with no link, which the form must refuse', () => {
    expect(findFirstUrl('長輩群組傳的，說吃這個可以防癌')).toBeNull()
    expect(findFirstUrl('')).toBeNull()
  })

  test('ignores a non-http scheme', () => {
    expect(findFirstUrl('javascript:alert(1)')).toBeNull()
  })
})
