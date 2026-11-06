import { describe, expect, test } from 'vitest'

import { parseReportUrl } from '../report'

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
})
