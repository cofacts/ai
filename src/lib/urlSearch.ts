// How the router reads and writes the query string.
//
// The router's default runs JSON.parse on every value, so `?q=12345678901234567890` reaches a
// page as a rounded number, `?q=1.50` as 1.5 and `?q=%22hi%22` as `hi`; the original text is
// gone before any schema sees it. It also writes strings with JSON quotes and lists as JSON
// arrays, which makes shared links hard to read.
//
// Here every value stays the text that was in the address bar, and each route's schema decides
// what it means (see searchParams.ts). A key given more than once (`?topic=a&topic=b`) becomes a
// list. Writing is the reverse: text as is, a list joined with commas (`replyType=rumor,not-rumor`),
// so list items must not contain commas. Our lists hold enum values and ids, which never do.

/** A query string (with or without the leading `?`) as text values, keyed by param name. */
export function parseSearch(
  searchStr: string,
): Record<string, string | Array<string>> {
  const entries = new Map<string, string | Array<string>>()
  for (const [key, value] of new URLSearchParams(searchStr)) {
    const prev = entries.get(key)
    entries.set(
      key,
      prev === undefined
        ? value
        : Array.isArray(prev)
          ? [...prev, value]
          : [prev, value],
    )
  }
  // fromEntries defines own properties, so a `__proto__` param is just a key.
  return Object.fromEntries(entries)
}

const toText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) {
    const items = value
      .map(toText)
      .filter((item): item is string => item !== undefined && item !== '')
    return items.length ? items.join(',') : undefined
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value as string | number | boolean | bigint)
}

/** The search object as a query string with a leading `?`, or `''` when there is nothing. */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    const text = toText(value)
    if (text !== undefined) params.set(key, text)
  }
  const str = params.toString()
  return str ? `?${str}` : ''
}
