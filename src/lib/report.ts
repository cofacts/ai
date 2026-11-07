/** The longest value `parseReportUrl` accepts; no real link comes close. */
export const MAX_REPORT_URL_LENGTH = 4096

/**
 * The link a reporter submitted, trimmed, or null when it is not one http(s)
 * link with a host.
 *
 * The report form needs one. An article has to point at something anyone can
 * open — that is what makes "this message is really circulating" checkable by
 * someone other than the reporter — and `ArticleReferenceInput` has no honest
 * value for "typed from memory" anyway.
 *
 * The form's rule, as the URL input's custom validity (UI only). It refuses
 * anything that is not a link outright — prose with a link in it, other
 * schemes (`javascript:`, `data:`, `mailto:`), a scheme with no host — rather
 * than trying to rescue a link from it.
 *
 * Also refused, anywhere inside the value:
 * - whitespace: `new URL()` would percent-encode it into the path, so
 *   "https://x.com/a 說很可怕" would otherwise pass with the reporter's words
 *   attached. A copied link never contains a raw space. Words glued to the
 *   link with no space ("https://x.com/a說很可怕") still pass: they cannot be
 *   told apart from a legitimate non-ASCII path such as zh.wikipedia's.
 * - control and format characters (`\p{Cc}`, `\p{Cf}`: NUL, zero-width
 *   characters, bidi overrides, BOM): invisible in the stored article, and
 *   able to make it display differently from what it links to.
 *
 * Returns the trimmed input, not `URL#href`: what the reporter pasted is what
 * gets stored and matched against existing articles, so it is not rewritten.
 */
export function parseReportUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_REPORT_URL_LENGTH) return null
  if (/[\s\p{Cc}\p{Cf}]/u.test(trimmed)) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  // `protocol` is lowercased, so `HTTPS://` (an auto-capitalised first
  // letter, say) is accepted, as the form's pattern accepts it.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return trimmed
}
