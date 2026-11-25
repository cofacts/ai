import { describe, expect, it } from 'vitest'

import { parseSearch, stringifySearch } from '../urlSearch'

describe('parseSearch', () => {
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
  ])('keeps number-like or JSON-like text as typed: %s', (text) => {
    const url = `?${new URLSearchParams({ q: text }).toString()}`
    expect(parseSearch(url)).toEqual({ q: text })
  })

  it('reads a repeated key as a list', () => {
    expect(parseSearch('?topic=b&topic=a&topic=c')).toEqual({
      topic: ['b', 'a', 'c'],
    })
  })

  it('accepts a query string with or without the leading ?', () => {
    expect(parseSearch('q=x')).toEqual(parseSearch('?q=x'))
    expect(parseSearch('')).toEqual({})
  })

  it('does not throw on malformed percent-encoding', () => {
    expect(() => parseSearch('?q=%E0%A4%A&status=%')).not.toThrow()
  })

  it('makes a __proto__ param only a key', () => {
    const parsed = parseSearch('?__proto__=x')
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.keys(parsed)).toEqual(['__proto__'])
  })
})

describe('stringifySearch', () => {
  it('writes plain text and comma lists, with the commas unencoded', () => {
    expect(
      stringifySearch({ q: '123', replyType: ['rumor', 'not-rumor'] }),
    ).toBe('?q=123&replyType=rumor,not-rumor')
  })

  it('reads back what it writes', () => {
    const search = { q: 'a,b "c" 疫苗', topic: ['x', 'y'] }
    expect(parseSearch(stringifySearch(search))).toEqual({
      q: 'a,b "c" 疫苗',
      topic: 'x,y',
    })
  })

  it('writes nothing for an empty search, an empty list or undefined', () => {
    expect(stringifySearch({})).toBe('')
    expect(stringifySearch({ replyType: [], q: undefined, x: null })).toBe('')
  })

  it('leaves out an object, which has no text form', () => {
    expect(stringifySearch({ q: 'x', bad: { a: 1 } })).toBe('?q=x')
  })
})
