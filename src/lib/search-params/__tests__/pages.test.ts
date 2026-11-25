import { describe, expect, it } from 'vitest'

import { parseSearch, stringifySearch } from '../../urlSearch'
import {
  articleListDefaults,
  articleListSearch,
  articleListSearchSchema,
  hoaxForYouSearchSchema,
  replyListSearchSchema,
  searchPageSearchSchema,
  userPageSearchSchema,
} from '../pages'
import type { z } from 'zod'
import type { ArticleListSearch } from '../pages'

// What a route sees for a given address bar: the router's parser, then the page's schema.
const fromUrl = <T>(schema: { parse: (v: unknown) => T }, url: string) =>
  schema.parse(parseSearch(url))
const articles = (input: unknown) => articleListSearchSchema.parse(input)

const ARTICLE_DEFAULTS = {
  q: '',
  status: [],
  replyType: [],
  articleType: [],
  topic: [],
  range: 'all',
  sort: 'latest-reported',
}

describe('defaults', () => {
  it('an empty search gives every default', () => {
    expect(articles({})).toEqual(ARTICLE_DEFAULTS)
    expect(articleListDefaults).toEqual(ARTICLE_DEFAULTS)
  })

  it('each page has its own', () => {
    expect(replyListSearchSchema.parse({})).toEqual({
      status: [],
      replyType: [],
      topic: [],
      range: 'all',
      sort: 'latest-replied',
    })
    expect(hoaxForYouSearchSchema.parse({})).toEqual({
      topic: [],
      range: 'all',
    })
    expect(searchPageSearchSchema.parse({})).toEqual({
      q: '',
      type: 'messages',
      status: [],
      replyType: [],
      topic: [],
      range: 'all',
    })
    expect(userPageSearchSchema.parse({})).toEqual({
      tab: 'replies',
      replyType: [],
      articleType: [],
      topic: [],
      range: 'all',
      sort: 'my-reply',
    })
  })
})

describe('/articles', () => {
  it('reads each condition from the address bar', () => {
    expect(
      fromUrl(
        articleListSearchSchema,
        '?q=疫苗&status=reported-many,no-useful-reply&replyType=rumor,not-rumor&articleType=image&topic=abc,def&range=week&sort=most-reported',
      ),
    ).toEqual({
      q: '疫苗',
      status: ['reported-many', 'no-useful-reply'],
      replyType: ['rumor', 'not-rumor'],
      articleType: ['image'],
      topic: ['abc', 'def'],
      range: 'week',
      sort: 'most-reported',
    })
  })

  it.each([
    ['unknown values', { status: 'nope', sort: 'nope', range: 'nope' }],
    ['wrong case', { status: 'Replied-Many', sort: 'MOST-REPORTED' }],
    ['numbers and booleans', { status: 1, sort: true, range: 0 }],
    ['null and objects', { status: null, replyType: { a: 1 }, q: { a: 1 } }],
    ['arrays where one value belongs', { sort: ['most-reported'] }],
    [
      'rumors-site params',
      { filters: 'NO_REPLY', types: 'RUMOR', orderBy: 'replyRequestCount' },
    ],
  ])('%s fall back instead of throwing', (_name, input) => {
    expect(articles(input)).toEqual(ARTICLE_DEFAULTS)
  })

  it.each([undefined, null, 'text', 42, []])(
    'a whole search of %j does not throw',
    (input) => {
      expect(() => articleListSearchSchema.safeParse(input)).not.toThrow()
    },
  )

  it('drops unknown params, __proto__ included', () => {
    expect(
      fromUrl(articleListSearchSchema, '?utm_source=x&page=3&__proto__=x'),
    ).toEqual(ARTICLE_DEFAULTS)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a custom range keeps its days; other ranges drop them', () => {
    expect(
      articles({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }),
    ).toMatchObject({ range: 'custom', from: '2026-10-01', to: '2026-10-31' })
    expect(articles({ range: 'custom', to: '2026-10-01' })).toMatchObject({
      range: 'custom',
      to: '2026-10-01',
    })
    expect(
      articles({ range: 'week', from: '2026-10-01', to: '2026-10-31' }),
    ).not.toHaveProperty('from')
  })

  it.each([
    ['no days', { range: 'custom' }],
    ['bad days', { range: 'custom', from: 'x', to: '2026-02-31' }],
    [
      'from after to',
      { range: 'custom', from: '2026-11-01', to: '2026-10-01' },
    ],
  ])('a custom range with %s is the default range', (_n, input) => {
    expect(articles(input)).toEqual(ARTICLE_DEFAULTS)
  })
})

describe('/replies', () => {
  it('offers neither 格式, a keyword nor 我送出的', () => {
    const parsed = replyListSearchSchema.parse({
      q: 'x',
      articleType: 'text',
      status: 'reported-by-me,replied-many',
    })
    expect(parsed).not.toHaveProperty('q')
    expect(parsed).not.toHaveProperty('articleType')
    expect(parsed.status).toEqual(['replied-many'])
  })

  it('sorts by the latest reply unless asked otherwise', () => {
    expect(replyListSearchSchema.parse({ sort: 'most-reported' }).sort).toBe(
      'most-reported',
    )
    expect(replyListSearchSchema.parse({ sort: 'my-reply' }).sort).toBe(
      'latest-replied',
    )
  })
})

describe('/hoax-for-you', () => {
  it('takes only topics and time', () => {
    expect(
      hoaxForYouSearchSchema.parse({
        topic: 'a',
        range: 'day',
        status: 'replied-many',
        sort: 'most-reported',
      }),
    ).toEqual({ topic: ['a'], range: 'day' })
  })
})

describe('/search', () => {
  it('keeps rumors-site’s type values', () => {
    expect(fromUrl(searchPageSearchSchema, '?q=x&type=replies').type).toBe(
      'replies',
    )
    expect(fromUrl(searchPageSearchSchema, '?q=x&type=bogus').type).toBe(
      'messages',
    )
  })

  it('searching replies keeps only 我查核過的 and no topic', () => {
    expect(
      searchPageSearchSchema.parse({
        type: 'replies',
        status: 'replied-by-me,reported-once',
        topic: 'a',
        replyType: 'rumor',
      }),
    ).toMatchObject({
      status: ['replied-by-me'],
      topic: [],
      replyType: ['rumor'],
    })
  })

  it('searching messages offers every condition', () => {
    expect(
      searchPageSearchSchema.parse({ status: 'reported-by-me', topic: 'a' }),
    ).toMatchObject({ status: ['reported-by-me'], topic: ['a'] })
  })
})

describe('user page', () => {
  it('reads the replies tab’s conditions', () => {
    expect(
      userPageSearchSchema.parse({
        sort: 'most-reported',
        articleType: 'image',
      }),
    ).toMatchObject({
      tab: 'replies',
      sort: 'most-reported',
      articleType: ['image'],
    })
  })

  it('the comments tab drops them', () => {
    expect(
      userPageSearchSchema.parse({
        tab: 'comments',
        sort: 'most-reported',
        topic: 'a',
        range: 'custom',
        from: '2026-10-01',
      }),
    ).toEqual({
      tab: 'comments',
      replyType: [],
      articleType: [],
      topic: [],
      range: 'all',
      sort: 'my-reply',
    })
  })
})

describe('shareable links', () => {
  // What the route's search middleware passes on for a parsed search.
  const stripDefaults = (search: Partial<ArticleListSearch>) =>
    articleListSearch.search.middlewares[0]!({ search, next: (s) => s })
  const linkFor = (url: string) =>
    stringifySearch(stripDefaults(fromUrl(articleListSearchSchema, url)))

  it.each([
    '',
    '?q=疫苗&replyType=rumor,not-rumor&range=custom&from=2026-10-01&to=2026-10-31',
    '?status=bogus,replied-many&topic=123,abc&sort=most-reported',
    '?q=%E0%A4%A&range=custom',
    '?q=12345678901234567890&topic=12345678901234567890',
    '?q=a%2Cb%20%22c%22',
  ])('parse → link → parse is stable: %s', (url) => {
    const first = fromUrl(articleListSearchSchema, url)
    expect(fromUrl(articleListSearchSchema, linkFor(url))).toEqual(first)
    expect(linkFor(linkFor(url))).toBe(linkFor(url))
  })

  it('a link carries only what differs from the defaults', () => {
    expect(linkFor('?q=疫苗&sort=latest-reported&range=all')).toBe(
      `?q=${encodeURIComponent('疫苗')}`,
    )
    expect(stripDefaults(articleListDefaults)).toEqual({})
  })
})

describe('link types', () => {
  type LinkSearch = z.input<typeof articleListSearchSchema>

  it('a link may set any accepted value and leave out the rest', () => {
    const ok: LinkSearch = { q: 'x', status: ['reported-many'] }
    const none: LinkSearch = {}
    const typo: LinkSearch = {
      // @ts-expect-error a misspelled value does not compile
      sort: 'most-reproted',
    }
    expect([ok, none, typo]).toHaveLength(3)
  })
})
