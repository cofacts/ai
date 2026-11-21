export type TextPart = { type: 'text' | 'link'; value: string }

// A URL ends at whitespace, CJK punctuation or full-width forms: zh-TW text is often written
// right after a link with no space (「見https://x.org，謝謝」). CJK characters themselves stay in
// the URL, since many references link to paths like https://zh.wikipedia.org/wiki/蔡英文.
const URL_PATTERN = new RegExp(
  'https?://[^\\s\\u3000-\\u303f\\uff00-\\uffef]+',
  'g',
)

// Punctuation that more likely belongs to the sentence than to the URL.
const TRAILING = /[.,;:!?'"\]]+$/

const count = (text: string, char: string) => text.split(char).length - 1

function trimUrl(url: string) {
  let end = url.replace(TRAILING, '')
  // A closing paren belongs to the URL only when it balances one inside it.
  while (end.endsWith(')') && count(end, ')') > count(end, '(')) {
    end = end.slice(0, -1).replace(TRAILING, '')
  }
  return end
}

/** Splits `text` into plain text and http(s) links, in order, losing no characters. */
export function splitLinks(text: string): Array<TextPart> {
  const parts: Array<TextPart> = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0])
    if (!url) continue
    if (match.index > last) {
      parts.push({ type: 'text', value: text.slice(last, match.index) })
    }
    parts.push({ type: 'link', value: url })
    last = match.index + url.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
