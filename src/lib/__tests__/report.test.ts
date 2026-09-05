import { describe, expect, test } from 'vitest'

import { buildReportPrefill, findFirstUrl, isJustLinks } from '../report'

// Android's Web Share Target and the iOS shortcut both hand off through the
// query string on `/`, and neither is consistent about which field holds the
// link. These cases are the shapes actually seen from Threads / Facebook /
// LINE, plus the ones that would produce a visibly wrong composer.
describe('buildReportPrefill', () => {
  test('uses the shared text as the body', () => {
    expect(buildReportPrefill({ text: '聽說明天台電要停電' })).toBe(
      '聽說明天台電要停電',
    )
  })

  test('uses a bare url when that is all that was shared', () => {
    expect(
      buildReportPrefill({ url: 'https://www.threads.net/@a/post/1' }),
    ).toBe('https://www.threads.net/@a/post/1')
  })

  test('appends the url below the text when both are present', () => {
    expect(
      buildReportPrefill({
        text: '這是真的嗎',
        url: 'https://www.threads.net/@a/post/1',
      }),
    ).toBe('這是真的嗎\nhttps://www.threads.net/@a/post/1')
  })

  test('does not repeat a url the text already contains', () => {
    // The common Facebook/Threads case: `text` is the post plus its own link,
    // and `url` repeats it. Appending would show the link twice.
    const url = 'https://www.threads.net/@a/post/1'
    expect(buildReportPrefill({ text: `快看這個 ${url}`, url })).toBe(
      `快看這個 ${url}`,
    )
  })

  test('recovers a url that was only put in the text', () => {
    // Some share sheets leave `url` empty and bury the link mid-sentence.
    expect(
      buildReportPrefill({ text: '朋友傳了 https://example.com/news 給我' }),
    ).toBe('朋友傳了 https://example.com/news 給我')
  })

  test('strips sentence punctuation stuck to the end of a url', () => {
    // 「…https://example.com/a。」 would otherwise prefill a link that 404s.
    expect(buildReportPrefill({ url: 'https://example.com/a。' })).toBe(
      'https://example.com/a',
    )
    expect(buildReportPrefill({ url: 'https://example.com/a).' })).toBe(
      'https://example.com/a',
    )
  })

  test('falls back to the title only when nothing else was shared', () => {
    expect(buildReportPrefill({ title: '停電公告' })).toBe('停電公告')
  })

  test('drops the title when there is real text, and keeps the url', () => {
    // Share sheets pass the page title, which is rarely the suspicious message.
    expect(
      buildReportPrefill({
        title: 'Threads',
        text: '這是真的嗎',
        url: 'https://www.threads.net/@a/post/1',
      }),
    ).toBe('這是真的嗎\nhttps://www.threads.net/@a/post/1')
  })

  test('returns empty for nothing to prefill, so the placeholder shows', () => {
    expect(buildReportPrefill(undefined)).toBe('')
    expect(buildReportPrefill({})).toBe('')
    expect(buildReportPrefill({ text: '   ', url: '  ', title: '' })).toBe('')
  })

  test('ignores a non-http url rather than prefilling a bad scheme', () => {
    expect(buildReportPrefill({ url: 'javascript:alert(1)' })).toBe('')
    expect(
      buildReportPrefill({ text: '看這個', url: 'javascript:alert(1)' }),
    ).toBe('看這個')
  })
})

describe('findFirstUrl', () => {
  test('finds a bare link, which is what a share sheet usually sends', () => {
    expect(findFirstUrl('https://www.facebook.com/share/p/1HSNRpimmH/')).toBe(
      'https://www.facebook.com/share/p/1HSNRpimmH/',
    )
  })

  test('finds a link embedded in prose the reporter typed', () => {
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

describe('isJustLinks', () => {
  test('a shared link on its own is just a link', () => {
    expect(isJustLinks('https://www.facebook.com/share/p/1HSNRpimmH/')).toBe(
      true,
    )
    expect(
      isJustLinks('  https://example.com/a\nhttps://example.com/b  '),
    ).toBe(true)
  })

  test('a link the reporter wrote around is not', () => {
    expect(isJustLinks('後座沒綁安全帶罰六千 https://example.com/a')).toBe(
      false,
    )
  })

  test('no text at all counts as no prose', () => {
    expect(isJustLinks('')).toBe(true)
  })
})
