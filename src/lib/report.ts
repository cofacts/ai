/**
 * Turning a share-sheet handoff into text for the composer.
 *
 * Android's Web Share Target and the iOS shortcut both land on `/report` with
 * the shared content in the query string, and neither is consistent about which
 * field holds what: Threads and Facebook sometimes put the link in `text` and
 * leave `url` empty, sometimes the reverse, and often repeat the link inside a
 * longer `text`. So both fields are scanned and the result is assembled from
 * whatever is actually there.
 *
 * Observed on Android: sharing a post from Facebook arrives as
 * `?text=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2F...` — the link in `text`,
 * no `url`, no `title`. A bare link with no prose of the user's own is the
 * normal case for share-sheet traffic, not an edge case.
 *
 * The output is a draft for the user to review, never something auto-sent —
 * they usually want to add "my mum forwarded me this" before sending.
 */

/** Query parameters accepted on `/report` from a share target or shortcut. */
export interface ReportSearch {
  url?: string
  text?: string
  title?: string
}

/**
 * Matches an http(s) URL up to the first whitespace.
 *
 * Trailing punctuation is trimmed separately: a link at the end of a sentence
 * ("看看這個 https://example.com/a。") would otherwise absorb the full stop and
 * stop resolving.
 */
const URL_RE = /https?:\/\/[^\s<>"']+/g

/** Sentence punctuation that cannot be the last character of a shared link. */
const TRAILING_PUNCT = /[.,;:!?。，、；：！？)\]}）】》」』]+$/

function firstUrl(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue
    const matches = candidate.match(URL_RE)
    if (!matches) continue
    for (const match of matches) {
      const cleaned = match.replace(TRAILING_PUNCT, '')
      if (cleaned) return cleaned
    }
  }
  return null
}

/**
 * Builds the composer draft for a shared item.
 *
 * Rules, in order of what the user gets out of them:
 * - The shared prose is the body, because that is the suspicious message.
 * - A link is appended only when the prose does not already contain it, so the
 *   common "text repeats the url" case does not produce it twice.
 * - `title` is dropped when the prose already exists (share sheets pass the page
 *   title, which is rarely the message) and used as the body only when nothing
 *   else is available.
 *
 * Returns an empty string when there is nothing to prefill, which leaves the
 * composer showing its normal placeholder.
 */
export function buildReportPrefill(search: ReportSearch | undefined): string {
  if (!search) return ''

  const text = search.text?.trim() ?? ''
  const url = search.url?.trim() ?? ''
  const title = search.title?.trim() ?? ''

  const link = firstUrl(url, text)
  const body = text || title

  if (!body) return link ?? ''
  if (link && !body.includes(link)) return `${body}\n${link}`
  return body
}

/**
 * The first http(s) URL in a block of text, or null when there is none.
 *
 * The report form requires one. An article has to point at something anyone can
 * open — that is what makes "this message is really circulating" checkable by
 * someone other than the reporter — and `ArticleReferenceInput` has no honest
 * value for "typed from memory" anyway.
 */
export function findFirstUrl(text: string): string | null {
  return firstUrl(text)
}
