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

const SITE_NAME = 'Cofacts 真的假的'
const FALLBACK_TITLE = '可疑訊息'

/**
 * The <head> of /article/:id: title, description, canonical URL and Open Graph
 * / Twitter tags for share previews. og:image comes later (cofacts/ai#210).
 */
export function getArticleHead({
  title,
  description,
  url,
}: {
  /** The start of the message; empty for a media message without text. */
  title: string
  description: string
  /** Absolute URL of the page, without a hash or query. */
  url: string
}) {
  const ogTitle = title || FALLBACK_TITLE
  return {
    meta: [
      { title: `${ogTitle} | ${SITE_NAME}` },
      ...(description ? [{ name: 'description', content: description }] : []),
      { property: 'og:type', content: 'article' },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:locale', content: 'zh_TW' },
      { property: 'og:url', content: url },
      { property: 'og:title', content: ogTitle },
      ...(description
        ? [{ property: 'og:description', content: description }]
        : []),
      { name: 'twitter:card', content: 'summary' },
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}

/**
 * The start of a message as one line, for <title> and descriptions: runs of
 * whitespace (an OCR'd image is many short lines) become one space, and it is
 * cut by character, so an emoji isn't split in half.
 */
export function summarizeText(text: string | null | undefined, length: number) {
  return Array.from((text ?? '').replace(/\s+/g, ' ').trim())
    .slice(0, length)
    .join('')
}
