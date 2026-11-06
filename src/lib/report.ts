/**
 * The link a reporter submitted, trimmed, or null when it is not one http(s)
 * link with a host.
 *
 * The report form needs one. An article has to point at something anyone can
 * open — that is what makes "this message is really circulating" checkable by
 * someone other than the reporter — and `ArticleReferenceInput` has no honest
 * value for "typed from memory" anyway.
 *
 * This is the server's check; the form's `type="url"` input is only UX, and
 * whatever passes here is stored publicly as the article text and its
 * `reference.permalink`. So it refuses anything that is not a link outright —
 * prose with a link in it, other schemes (`javascript:`, `data:`, `mailto:`),
 * a scheme with no host — rather than trying to rescue a link from it.
 *
 * Whitespace inside the value is refused too: `new URL()` would percent-encode
 * it into the path, so "https://x.com/a 說很可怕" would otherwise pass with the
 * reporter's words attached. A link copied from an address bar or a share
 * button never contains a raw space.
 *
 * Returns the trimmed input, not `URL#href`: what the reporter pasted is what
 * gets stored and matched against existing articles, so it is not rewritten.
 */
export function parseReportUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return trimmed
}
