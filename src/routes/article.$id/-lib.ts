// Shared by the article page and its -components: the section anchors of
// /article/:id (Phase 3 design doc §2.4), so links into the page keep working.

export const ARTICLE_SECTION_IDS = {
  replies: 'replies',
  aiAnalysis: 'ai-analysis',
  similar: 'similar',
  original: 'original',
} as const

/** The anchor of one fact-check reply: /article/:id#reply-:replyId. */
export function replyAnchorId(replyId: string) {
  return `reply-${replyId}`
}

export type QuickNavItem = {
  id: string
  label: string
  /**
   * Listed only in the mobile row. On desktop the section sits in the right
   * column (Penpot MessagePage-1440), so 快速索引 leaves it out.
   */
  mobileOnly?: boolean
}

/**
 * The 本頁索引 entries, in page order (Penpot MessagePage-1440 /
 * MessagePage-原始訊息). AI 自動分析 is shown only while the article has no
 * fact-check reply, so its entry comes and goes with it.
 */
export function getQuickNavItems({
  replyCount,
}: {
  replyCount: number
}): Array<QuickNavItem> {
  return [
    { id: ARTICLE_SECTION_IDS.original, label: '原始訊息' },
    { id: ARTICLE_SECTION_IDS.replies, label: `查核回應 (${replyCount})` },
    ...(replyCount === 0
      ? [{ id: ARTICLE_SECTION_IDS.aiAnalysis, label: 'AI 自動分析' }]
      : []),
    {
      id: ARTICLE_SECTION_IDS.similar,
      label: '相似可疑訊息與組合',
      mobileOnly: true,
    },
  ]
}

export type TextSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

// http(s) URLs up to the next whitespace or full-width punctuation. Closing
// punctuation that usually ends a sentence, not the URL, is left out: 「…請看 https://example.com/a.」
const URL_PATTERN = /https?:\/\/[^\s<>"'「」『』（）。，！？；：、]+/g
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、)\]}]+$/

/**
 * Splits a message into plain text and links, so the page can render the links
 * as `<a>` without `dangerouslySetInnerHTML` (rumors-site's `linkify`).
 */
export function linkifyText(text: string): Array<TextSegment> {
  const segments: Array<TextSegment> = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '')
    if (url.endsWith('://')) continue // only the scheme was left
    const start = match.index
    if (start > last)
      segments.push({ type: 'text', text: text.slice(last, start) })
    segments.push({ type: 'link', text: url, href: url })
    last = start + url.length
  }
  if (last < text.length)
    segments.push({ type: 'text', text: text.slice(last) })
  return segments
}

export type CategoryVotes = {
  positiveFeedbackCount?: number | null
  negativeFeedbackCount?: number | null
}

/**
 * More people disagree with the category than agree: rumors-site still lists it,
 * struck through.
 */
export function isCategoryDisputed({
  positiveFeedbackCount,
  negativeFeedbackCount,
}: CategoryVotes) {
  return (negativeFeedbackCount ?? 0) > (positiveFeedbackCount ?? 0)
}

/** Agree / disagree shares in whole percent, or null when nobody has voted. */
export function categoryVoteShares({
  positiveFeedbackCount,
  negativeFeedbackCount,
}: CategoryVotes): { agree: number; disagree: number } | null {
  const agree = positiveFeedbackCount ?? 0
  const disagree = negativeFeedbackCount ?? 0
  const total = agree + disagree
  if (total === 0) return null
  return {
    agree: Math.floor((agree / total) * 100),
    disagree: Math.floor((disagree / total) * 100),
  }
}

/** First reported on, as a date: 2026/11/17. */
export function formatReportedDate(iso: string | null | undefined) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Taipei',
  }).format(date)
}
