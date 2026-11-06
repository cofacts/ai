import { describe, expect, test } from 'vitest'

import { MAX_REPORT_URL_LENGTH, parseReportUrl } from '../report'

describe('parseReportUrl', () => {
  test('accepts an https link as pasted', () => {
    expect(
      parseReportUrl(
        'https://www.facebook.com/share/p/1HSNRpimmH/?mibextid=wwXIfr&rdid=abc',
      ),
    ).toBe(
      'https://www.facebook.com/share/p/1HSNRpimmH/?mibextid=wwXIfr&rdid=abc',
    )
    expect(
      parseReportUrl('https://en.wikipedia.org/wiki/Mercury_(planet)'),
    ).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)')
  })

  test('accepts an http link', () => {
    expect(parseReportUrl('http://example.com/a')).toBe('http://example.com/a')
  })

  test('does not rewrite the link into its normalized form', () => {
    // It is stored, and matched against existing articles, as pasted.
    expect(parseReportUrl('https://EXAMPLE.com')).toBe('https://EXAMPLE.com')
    expect(parseReportUrl('https://X.com')).toBe('https://X.com')
  })

  test('accepts an upper-case scheme, as the form does', () => {
    expect(parseReportUrl('Https://x.com/a')).toBe('Https://x.com/a')
    expect(parseReportUrl('HTTP://x.com/a')).toBe('HTTP://x.com/a')
  })

  test('accepts a link with a non-ASCII path', () => {
    expect(parseReportUrl('https://zh.wikipedia.org/wiki/臺灣')).toBe(
      'https://zh.wikipedia.org/wiki/臺灣',
    )
  })

  test('trims surrounding whitespace', () => {
    expect(parseReportUrl('  https://example.com/a\n')).toBe(
      'https://example.com/a',
    )
  })

  test('rejects an empty value', () => {
    expect(parseReportUrl('')).toBeNull()
    expect(parseReportUrl('   \n')).toBeNull()
  })

  test('rejects prose, even with a link in it', () => {
    expect(parseReportUrl('看看這個 https://example.com/a')).toBeNull()
    expect(parseReportUrl('https://example.com/a 說很可怕')).toBeNull()
    expect(parseReportUrl('長輩群組傳的，說吃這個可以防癌')).toBeNull()
  })

  test('rejects other schemes', () => {
    expect(parseReportUrl('javascript:alert(1)')).toBeNull()
    expect(parseReportUrl('ftp://x.com')).toBeNull()
    expect(parseReportUrl('mailto:a@b.c')).toBeNull()
    expect(parseReportUrl('data:text/html,x')).toBeNull()
  })

  test('rejects a scheme with no host', () => {
    expect(parseReportUrl('https://')).toBeNull()
  })

  test('rejects a bare domain', () => {
    expect(parseReportUrl('example.com')).toBeNull()
  })

  test('rejects control and invisible format characters inside the link', () => {
    expect(parseReportUrl('https://x.com/a\u0000b')).toBeNull() // NUL
    expect(parseReportUrl('https://x.com/a\u0007')).toBeNull() // BEL
    expect(parseReportUrl('https://x.com/a\u200bb')).toBeNull() // zero-width space
    expect(parseReportUrl('https://x.com/a\u202eb')).toBeNull() // bidi override
    expect(parseReportUrl('https://x.com/a\ufeffb')).toBeNull() // BOM
  })

  test('rejects a value over the length cap', () => {
    const prefix = 'https://x.com/'
    const atCap = prefix + 'a'.repeat(MAX_REPORT_URL_LENGTH - prefix.length)
    expect(parseReportUrl(atCap)).toBe(atCap)
    expect(parseReportUrl(atCap + 'a')).toBeNull()
  })

  test('rejects anything that is not a string', () => {
    // It guards an RPC, so the input is whatever the caller sent.
    expect(parseReportUrl(undefined)).toBeNull()
    expect(parseReportUrl(null)).toBeNull()
    expect(parseReportUrl(42)).toBeNull()
    expect(parseReportUrl(['https://x.com'])).toBeNull()
    expect(parseReportUrl({ url: 'https://x.com' })).toBeNull()
  })
})
