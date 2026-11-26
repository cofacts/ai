import { describe, expect, it } from 'vitest'

import { z } from 'zod'
import {
  keyword,
  pickMany,
  rangeFields,
  replyTypes,
  statuses,
  topics,
} from '../fields'
import { ARTICLE_STATUSES, MAX_KEYWORD_LENGTH, MAX_TOPICS } from '../values'

const parseRange = (input: unknown) => z.object(rangeFields).parse(input)

describe('lists', () => {
  const kinds = pickMany(['a', 'b', 'c'] as const)

  it('reads a comma list, an array or a single value', () => {
    expect(kinds.parse('c,a')).toEqual(['a', 'c'])
    expect(kinds.parse(['c', 'a'])).toEqual(['a', 'c'])
    expect(kinds.parse('b')).toEqual(['b'])
  })

  it('keeps the valid items and drops the rest', () => {
    expect(kinds.parse('a,,bogus, c ,a,A')).toEqual(['a', 'c'])
  })

  it.each([undefined, null, 42, { a: 1 }, ''])('%j is an empty list', (raw) => {
    expect(kinds.parse(raw)).toEqual([])
  })

  it('equal selections give the same list whatever the order', () => {
    expect(replyTypes.parse('opinionated,rumor')).toEqual(
      replyTypes.parse('rumor,opinionated'),
    )
  })

  it('reply types explain their any-of meaning', () => {
    expect(replyTypes.description).toMatch(/any-of/)
  })
})

describe('statuses', () => {
  const all = statuses(ARTICLE_STATUSES)

  it('reads several conditions', () => {
    expect(all.parse('replied-many,reported-once')).toEqual([
      'reported-once',
      'replied-many',
    ])
  })

  it.each([
    ['reported-once,reported-many'],
    ['no-useful-reply,has-useful-reply'],
    ['replied-by-me,not-replied-by-me'],
  ])('an exclusive pair keeps neither: %s', (raw) => {
    expect(all.parse(`${raw},replied-many`)).toEqual(['replied-many'])
  })

  it('drops conditions the page does not offer', () => {
    expect(
      statuses(['replied-by-me']).parse('replied-by-me,reported-once'),
    ).toEqual(['replied-by-me'])
  })

  it('a pair is only exclusive among the offered conditions', () => {
    expect(
      statuses(['replied-by-me']).parse('replied-by-me,not-replied-by-me'),
    ).toEqual(['replied-by-me'])
  })
})

describe('topics', () => {
  it('keeps id-shaped values, sorted and unique', () => {
    expect(topics.parse('b,a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('drops anything that is not id-shaped', () => {
    expect(topics.parse('ok,<b>,a b,../x,' + 'x'.repeat(65))).toEqual(['ok'])
  })

  it('caps how many', () => {
    const many = Array.from({ length: MAX_TOPICS + 10 }, (_, i) => `t${i}`)
    expect(topics.parse(many)).toHaveLength(MAX_TOPICS)
  })
})

describe('keyword', () => {
  it('turns a number or boolean back into text', () => {
    expect(keyword.parse(123)).toBe('123')
    expect(keyword.parse(true)).toBe('true')
  })

  it('trims, collapses whitespace and turns control characters into spaces', () => {
    expect(keyword.parse('  a \n\t b\u0000c  ')).toBe('a b c')
  })

  it('removes invisible characters but keeps emoji joiners', () => {
    expect(keyword.parse('a\u200Bb\u202Ec\uFEFF')).toBe('abc')
    expect(keyword.parse('👨\u200D👩\u200D👧')).toBe('👨\u200D👩\u200D👧')
  })

  it('keeps a pasted message up to the cap without splitting a character', () => {
    const q = keyword.parse('😀'.repeat(MAX_KEYWORD_LENGTH + 50))
    expect(Array.from(q)).toHaveLength(MAX_KEYWORD_LENGTH)
    expect(q).not.toMatch(/�/)
  })

  it('a cut that lands on a space leaves no trailing space', () => {
    const q = keyword.parse(
      'a'.repeat(MAX_KEYWORD_LENGTH - 1) + ' ' + 'b'.repeat(10),
    )
    expect(q).toBe('a'.repeat(MAX_KEYWORD_LENGTH - 1))
    expect(keyword.parse(q)).toBe(q)
  })

  it.each([
    '<script>alert(1)</script>',
    '"; DROP TABLE articles;--',
    '\uD800',
    '{"a":',
    '../../etc/passwd',
  ])('hostile or garbled text is only text: %s', (q) => {
    expect(typeof keyword.parse(q)).toBe('string')
  })

  it.each([null, undefined, ['a', 'b'], { a: 1 }])('%j is empty', (raw) => {
    expect(keyword.parse(raw)).toBe('')
  })
})

describe('days', () => {
  it.each([
    '2026-2-1',
    '20261001',
    '2026-10-01T00:00:00Z',
    '2025-02-29',
    '2026-02-31',
    '0000-00-00',
  ])('rejects %s', (from) => {
    expect(parseRange({ range: 'custom', from }).from).toBeUndefined()
  })

  it('accepts a leap day', () => {
    expect(parseRange({ range: 'custom', from: '2028-02-29' }).from).toBe(
      '2028-02-29',
    )
  })

  it('an unknown range is the default', () => {
    expect(parseRange({ range: 'year' }).range).toBe('all')
  })
})
