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
 * Cofacts' share image (rumors-site's landing-page ogimage.png, in public/).
 * Every article uses it until /article/:id/og.png is generated per article
 * (cofacts/ai#210).
 */
export const OG_IMAGE = {
  path: '/og-image.png',
  width: 702,
  height: 484,
  alt: '懷疑自己收到謠言嗎？點我加 LINE 查謠言，或搜尋 Line ID: @cofacts',
}

/**
 * The <head> of /article/:id: title, description, canonical URL and Open Graph
 * / Twitter tags for share previews.
 */
export function getArticleHead({
  title,
  description,
  url,
  imageUrl,
}: {
  /** The start of the message; empty for a media message without text. */
  title: string
  description: string
  /** Absolute URL of the page, without a hash or query. */
  url: string
  /** Absolute URL of OG_IMAGE. */
  imageUrl: string
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
      { property: 'og:image', content: imageUrl },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: String(OG_IMAGE.width) },
      { property: 'og:image:height', content: String(OG_IMAGE.height) },
      { property: 'og:image:alt', content: OG_IMAGE.alt },
      { name: 'twitter:card', content: 'summary_large_image' },
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
