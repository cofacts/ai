/**
 * Reading a share-sheet handoff.
 *
 * Android's Web Share Target and the iOS shortcut both land on `/report` with
 * the shared content in the query string, and neither is consistent about which
 * field holds what: Threads and Facebook sometimes put the link in `text` and
 * leave `url` empty, sometimes the reverse, and often repeat the link inside a
 * longer `text`. So both fields are scanned for the link.
 *
 * Observed on Android: sharing a post from Facebook arrives as
 * `?text=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2F...` — the link in `text`,
 * no `url`, no `title`.
 *
 * The link is all the form takes, so the link is all that is read here. Prose
 * that came with it is dropped rather than prefilled: a report is a URL plus
 * the reporter's own reason, and someone else's share text is neither.
 */

/**
 * Query parameters accepted on `/report` from a share target or shortcut.
 *
 * `title` is declared in the manifest's `share_target` and accepted here even
 * though nothing reads it. Declaring it is what makes Android put the page
 * title in `title` instead of prepending it to `text` — so the field earns its
 * place by keeping `text` clean, not by being used.
 */
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
const URL_RE = /https?:\/\/[^\s<>"']+/

/** Sentence punctuation that cannot be the last character of a link. */
const TRAILING_PUNCT = new Set('.,;:!?。，、；：！？')

/**
 * Closing brackets, mapped to their openers.
 *
 * Unlike sentence punctuation these can legitimately end a link —
 * `https://en.wikipedia.org/wiki/Mercury_(planet)` — so one is trimmed only
 * when the link does not contain its opener, i.e. when it belongs to the
 * surrounding prose: "(see https://x.com/a)".
 */
const CLOSER_TO_OPENER: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '）': '（',
  '】': '【',
  '》': '《',
  '」': '「',
  '』': '『',
}

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

/** Drops whatever the surrounding sentence left stuck to the end of a link. */
function trimTrailing(link: string): string {
  // Never empties: every link starts with `http`, which is neither.
  let trimmed = link
  for (;;) {
    const last = trimmed.slice(-1)
    const opener = CLOSER_TO_OPENER[last]
    const unbalanced =
      opener !== undefined && count(trimmed, last) > count(trimmed, opener)
    if (!TRAILING_PUNCT.has(last) && !unbalanced) return trimmed
    trimmed = trimmed.slice(0, -1)
  }
}

/**
 * The first http(s) URL across the given candidates, or null when there is none.
 *
 * The report form needs one. An article has to point at something anyone can
 * open — that is what makes "this message is really circulating" checkable by
 * someone other than the reporter — and `ArticleReferenceInput` has no honest
 * value for "typed from memory" anyway.
 */
export function findFirstUrl(
  ...candidates: Array<string | undefined>
): string | null {
  for (const candidate of candidates) {
    const match = candidate?.match(URL_RE)
    if (match) return trimTrailing(match[0])
  }
  return null
}

/** The shared link, wherever the sending app decided to put it. */
export function findSharedUrl(search: ReportSearch | undefined): string | null {
  return findFirstUrl(search?.url, search?.text)
}
