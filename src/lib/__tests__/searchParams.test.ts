import { describe, expect, it } from 'vitest'

import {
  MAX_KEYWORD_LENGTH,
  MAX_TOPICS,
  articleListDefaults,
  articleListSearchSchema,
  omitDefaults,
  profileDefaults,
  profileSearchSchema,
  replyListDefaults,
  replyListSearchSchema,
  resolveTimeRange,
  searchPageDefaults,
  searchPageSearchSchema,
} from '../searchParams'
import { parseSearch, stringifySearch } from '../urlSearch'

const parse = (s: unknown) => articleListSearchSchema.parse(s)
// What a route sees for a given address bar: the router's parser, then our schema.
const fromUrl = <T>(schema: { parse: (v: unknown) => T }, url: string) =>
  schema.parse(parseSearch(url))

const ARTICLE_DEFAULTS = {
  q: '',
  status: 'all',
  replyType: [],
  articleType: [],
  topic: [],
  range: 'month',
  sort: 'latest-reported',
}

describe('defaults', () => {
  it('an empty search gives every default', () => {
    expect(parse({})).toEqual(ARTICLE_DEFAULTS)
    expect(fromUrl(articleListSearchSchema, '')).toEqual(ARTICLE_DEFAULTS)
  })

  it('profile and search pages have their own defaults', () => {
    expect(profileSearchSchema.parse({})).toEqual({ tab: 'replies' })
    expect(searchPageSearchSchema.parse({})).toEqual({
      q: '',
      in: 'article',
      range: 'all',
    })
    expect(replyListSearchSchema.parse({})).toEqual({
      q: '',
      replyType: [],
      topic: [],
      range: 'month',
      sort: 'newest',
    })
  })

  it('the exported defaults are what an empty search gives', () => {
    expect(articleListDefaults).toEqual(ARTICLE_DEFAULTS)
    expect(replyListDefaults).toEqual(replyListSearchSchema.parse({}))
    expect(searchPageDefaults).toEqual(searchPageSearchSchema.parse({}))
    expect(profileDefaults).toEqual({ tab: 'replies' })
  })
})

describe('valid values', () => {
  it('reads each condition', () => {
    expect(
      fromUrl(
        articleListSearchSchema,
        '?q=疫苗&status=replied&replyType=rumor,not-rumor&articleType=image&topic=abc,def&range=week&sort=most-reported',
      ),
    ).toEqual({
      q: '疫苗',
      status: 'replied',
      replyType: ['rumor', 'not-rumor'],
      articleType: ['image'],
      topic: ['abc', 'def'],
      range: 'week',
      sort: 'most-reported',
    })
  })

  it('accepts a list given as an array', () => {
    expect(parse({ replyType: ['opinionated', 'rumor'] }).replyType).toEqual([
      'rumor',
      'opinionated',
    ])
  })

  it('profile tab and search target', () => {
    expect(profileSearchSchema.parse({ tab: 'reports' })).toEqual({
      tab: 'reports',
    })
    expect(searchPageSearchSchema.parse({ q: 'x', in: 'reply' }).in).toBe(
      'reply',
    )
  })
})

describe('invalid values fall back instead of throwing', () => {
  it.each([
    ['unknown enum', { status: 'nope', sort: 'nope', range: 'nope' }],
    ['wrong case', { status: 'Replied', sort: 'NEWEST' }],
    ['numbers and booleans', { status: 1, sort: true, range: 0 }],
    [
      'null and objects',
      { status: null, replyType: { a: 1 }, q: { a: 1 }, topic: null },
    ],
    ['arrays where a scalar belongs', { status: ['replied'], sort: [] }],
  ])('%s', (_name, input) => {
    expect(parse(input)).toEqual(ARTICLE_DEFAULTS)
  })

  it.each([undefined, null, 'text', 42, []])('whole search is %j', (input) => {
    expect(() => {
      articleListSearchSchema.safeParse(input)
    }).not.toThrow()
  })

  it('drops unknown params', () => {
    expect(fromUrl(articleListSearchSchema, '?utm_source=x&page=3')).toEqual(
      ARTICLE_DEFAULTS,
    )
  })

  it('a __proto__ param is only an unknown key', () => {
    // JSON.parse makes __proto__ an own key, as a hostile parsed search would have it.
    const hostile: unknown = JSON.parse(
      '{"__proto__":{"polluted":1},"status":"replied"}',
    )
    expect(parse(hostile)).toEqual({ ...ARTICLE_DEFAULTS, status: 'replied' })
    expect(
      fromUrl(articleListSearchSchema, '?__proto__=x&status=replied'),
    ).toEqual({ ...ARTICLE_DEFAULTS, status: 'replied' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a list keeps its valid items and drops the rest', () => {
    expect(
      parse({
        replyType: 'rumor,,bogus, not-article ,rumor',
        articleType: 'TEXT,text',
      }).replyType,
    ).toEqual(['rumor', 'not-article'])
    expect(parse({ articleType: 'TEXT,text' }).articleType).toEqual(['text'])
  })

  it('equal selections give the same result whatever the order', () => {
    expect(parse({ replyType: 'opinionated,rumor' })).toEqual(
      parse({ replyType: 'rumor,opinionated' }),
    )
  })
})

describe('keyword', () => {
  it.each([
    '123',
    'true',
    'null',
    '12345678901234567890',
    '1e3',
    '1.50',
    '"hi"',
    '[1,2]',
    '0912345678',
  ])('number-like or JSON-like text stays as typed: %s', (text) => {
    const url = `?${new URLSearchParams({ q: text }).toString()}`
    expect(fromUrl(articleListSearchSchema, url).q).toBe(text)
  })

  it('still turns a number or boolean back into text', () => {
    expect(parse({ q: 123 }).q).toBe('123')
    expect(parse({ q: true }).q).toBe('true')
  })

  it('trims, collapses whitespace and strips control characters', () => {
    expect(parse({ q: '  a \n\t b\u0000c  ' }).q).toBe('a b c')
  })

  it('caps the length without splitting a character', () => {
    const q = parse({ q: '😀'.repeat(MAX_KEYWORD_LENGTH + 50) }).q
    expect(Array.from(q)).toHaveLength(MAX_KEYWORD_LENGTH)
    expect(q).not.toMatch(/�/)
  })

  it('a cut that lands on a space leaves no trailing space', () => {
    const q = parse({
      q: 'a'.repeat(MAX_KEYWORD_LENGTH - 1) + ' ' + 'b'.repeat(10),
    }).q
    expect(q).toBe('a'.repeat(MAX_KEYWORD_LENGTH - 1))
    expect(parse({ q }).q).toBe(q)
  })

  it.each([
    '<script>alert(1)</script>',
    '"; DROP TABLE articles;--',
    '%E0%A4%A',
    '\uD800',
    '{"a":',
    '../../etc/passwd',
  ])('hostile or garbled text is only text: %s', (q) => {
    expect(typeof parse({ q }).q).toBe('string')
  })

  it('malformed percent-encoding in the address does not throw', () => {
    expect(() =>
      fromUrl(articleListSearchSchema, '?q=%E0%A4%A&status=%'),
    ).not.toThrow()
  })
})

describe('topics', () => {
  it('keeps id-shaped values, sorted and unique', () => {
    expect(parse({ topic: 'b,a,b,c' }).topic).toEqual(['a', 'b', 'c'])
  })

  it('drops anything that is not id-shaped', () => {
    expect(parse({ topic: 'ok,<b>,a b,../x,' + 'x'.repeat(65) }).topic).toEqual(
      ['ok'],
    )
  })

  it('caps how many', () => {
    const many = Array.from({ length: MAX_TOPICS + 10 }, (_, i) => `t${i}`)
    expect(parse({ topic: many }).topic).toHaveLength(MAX_TOPICS)
  })

  it('long numeric ids keep every digit', () => {
    expect(
      fromUrl(articleListSearchSchema, '?topic=12345678901234567890').topic,
    ).toEqual(['12345678901234567890'])
  })

  it('a repeated key is read as a list', () => {
    expect(fromUrl(articleListSearchSchema, '?topic=b&topic=a').topic).toEqual([
      'a',
      'b',
    ])
  })
})

describe('time range', () => {
  it('a custom range keeps from and to', () => {
    expect(
      parse({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }),
    ).toMatchObject({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
    })
  })

  it('a custom range may be open at one end', () => {
    expect(parse({ range: 'custom', from: '2026-10-01' })).toMatchObject({
      range: 'custom',
      from: '2026-10-01',
    })
    expect(parse({ range: 'custom', to: '2026-10-01' }).from).toBeUndefined()
  })

  it.each([
    ['no dates', { range: 'custom' }],
    ['both dates bad', { range: 'custom', from: 'x', to: '2026-02-31' }],
    [
      'from after to',
      { range: 'custom', from: '2026-11-01', to: '2026-10-01' },
    ],
  ])('custom with %s falls back to the default range', (_n, input) => {
    expect(parse(input)).toEqual(ARTICLE_DEFAULTS)
  })

  it('a bad end is dropped, the good end stays', () => {
    expect(
      parse({ range: 'custom', from: '2026-10-01', to: '2026-13-01' }),
    ).toMatchObject({
      range: 'custom',
      from: '2026-10-01',
    })
  })

  it('from and to are ignored unless the range is custom', () => {
    expect(
      parse({ range: 'week', from: '2026-10-01', to: '2026-10-31' }),
    ).not.toHaveProperty('from')
  })

  it.each([
    '2026-2-1',
    '20261001',
    '2026-10-01T00:00:00Z',
    '2025-02-29',
    '0000-00-00',
  ])('rejects %s as a day', (from) => {
    expect(parse({ range: 'custom', from })).toEqual(ARTICLE_DEFAULTS)
  })

  it('accepts a leap day', () => {
    expect(parse({ range: 'custom', from: '2028-02-29' }).from).toBe(
      '2028-02-29',
    )
  })

  it('the search page defaults to no limit, and a bad custom returns to it', () => {
    expect(searchPageSearchSchema.parse({ range: 'custom' }).range).toBe('all')
  })
})

describe('reply list', () => {
  it('relevance needs a keyword', () => {
    expect(replyListSearchSchema.parse({ sort: 'relevance' }).sort).toBe(
      'newest',
    )
    expect(
      replyListSearchSchema.parse({ sort: 'relevance', q: 'x' }).sort,
    ).toBe('relevance')
  })

  it('does not take the message-only conditions', () => {
    const parsed = replyListSearchSchema.parse({
      status: 'replied',
      articleType: 'text',
    })
    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('articleType')
  })
})

describe('shareable URLs', () => {
  const urls = [
    '',
    '?q=疫苗&replyType=rumor,not-rumor&range=custom&from=2026-10-01&to=2026-10-31',
    '?status=bogus&topic=123,abc&sort=most-reported',
    '?q=%E0%A4%A&range=custom',
    '?q=12345678901234567890&topic=12345678901234567890',
    '?q=a%2Cb%20%22c%22',
  ]

  const linkFor = (url: string) =>
    stringifySearch(
      omitDefaults(fromUrl(articleListSearchSchema, url), articleListDefaults),
    )

  it.each(urls)('parse → stringify → parse is stable: %s', (url) => {
    const first = fromUrl(articleListSearchSchema, url)
    expect(fromUrl(articleListSearchSchema, linkFor(url))).toEqual(first)
    // Writing the same search again gives the same link.
    expect(linkFor(linkFor(url))).toBe(linkFor(url))
  })

  it('a link carries only what differs from the defaults', () => {
    const first = fromUrl(
      articleListSearchSchema,
      '?q=疫苗&sort=latest-reported',
    )
    expect(omitDefaults(first, articleListDefaults)).toEqual({ q: '疫苗' })
  })

  it('a link has plain text and comma lists, no JSON', () => {
    expect(
      stringifySearch({ q: '123', replyType: ['rumor', 'not-rumor'] }),
    ).toBe('?q=123&replyType=rumor%2Cnot-rumor')
    expect(
      fromUrl(articleListSearchSchema, '?replyType=rumor%2Cnot-rumor')
        .replyType,
    ).toEqual(['rumor', 'not-rumor'])
  })

  it('an empty search or an empty list writes nothing', () => {
    expect(stringifySearch({})).toBe('')
    expect(stringifySearch({ replyType: [], q: undefined })).toBe('')
  })
})

describe('resolveTimeRange', () => {
  const now = new Date('2026-11-20T04:00:00.000Z')

  it('all is no limit', () => {
    expect(resolveTimeRange({ range: 'all' }, now)).toBeUndefined()
  })

  it('counts back from now', () => {
    expect(resolveTimeRange({ range: 'week' }, now)).toEqual({
      gte: '2026-11-13T04:00:00.000Z',
      lte: '2026-11-20T04:00:00.000Z',
    })
    expect(resolveTimeRange({ range: 'month' }, now)?.gte).toBe(
      '2026-10-21T04:00:00.000Z',
    )
    expect(resolveTimeRange({ range: 'quarter' }, now)?.gte).toBe(
      '2026-08-22T04:00:00.000Z',
    )
  })

  it('custom days are Taiwan days, whole', () => {
    expect(
      resolveTimeRange(
        { range: 'custom', from: '2026-10-01', to: '2026-10-31' },
        now,
      ),
    ).toEqual({
      gte: '2026-10-01T00:00:00.000+08:00',
      lte: '2026-10-31T23:59:59.999+08:00',
    })
    expect(
      resolveTimeRange({ range: 'custom', from: '2026-10-01' }, now),
    ).toEqual({
      gte: '2026-10-01T00:00:00.000+08:00',
    })
  })

  it('custom bounds are valid dates for the API', () => {
    const r = resolveTimeRange(
      { range: 'custom', from: '2026-10-01', to: '2026-10-31' },
      now,
    )
    expect(Number.isNaN(Date.parse(r?.gte ?? ''))).toBe(false)
    expect(Number.isNaN(Date.parse(r?.lte ?? ''))).toBe(false)
  })
})
