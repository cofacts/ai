import { replyTypeText } from '@/components/FactCheckReplyTitle'

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

/** The size of /article/:id/og.png. */
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
const FALLBACK_TITLE = '可疑訊息'

/**
 * The <head> of /article/:id: title, description, canonical URL and Open Graph
 * / Twitter tags for share previews. og:image comes later (cofacts/ai#210).
 */
export function getArticleHead({
  title,
  description,
  url,
  imageUrl,
  verdict,
}: {
  /** The start of the message; empty for a media message without text. */
  title: string
  description: string
  /** Absolute URL of the page, without a hash or query. */
  url: string
  /** Absolute URL of /article/:id/og.png, with its ?v=. */
  imageUrl: string
  /** What the card says about the fact-check (ogVerdict). */
  verdict: OgReplyType | null
}) {
  const ogTitle = title || FALLBACK_TITLE
  const imageAlt = `${ogTitle}（${
    verdict ? `Cofacts 查核：${replyTypeText[verdict]}` : 'Cofacts 查核中'
  }）`
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
      { property: 'og:image:width', content: String(OG_IMAGE_WIDTH) },
      { property: 'og:image:height', content: String(OG_IMAGE_HEIGHT) },
      { property: 'og:image:alt', content: imageAlt },
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

export type OgReplyType = 'RUMOR' | 'NOT_RUMOR' | 'OPINIONATED' | 'NOT_ARTICLE'

/** The data /article/:id/og.png is drawn from; the version and the card depend on nothing else. */
export type OgCardData = {
  status: string | null | undefined
  replyTypes: ReadonlyArray<string | null | undefined>
  replyRequestCount: number | null | undefined
}

/**
 * Bump when the card's layout changes, so every og.png URL changes and share
 * previews fetch the new look instead of their cached copy.
 */
const OG_CARD_LAYOUT = 1

// Ties go to the type listed first.
const VERDICT_ORDER: ReadonlyArray<OgReplyType> = [
  'RUMOR',
  'NOT_RUMOR',
  'OPINIONATED',
  'NOT_ARTICLE',
]

/**
 * The fact-check result the card shows: the most common reply type, ties going to
 * RUMOR first; null while there is no reply.
 *
 * REMINDER: a placeholder rule until the designer decides what the card shows
 * (cofacts/ai#210).
 */
export function ogVerdict(
  replyTypes: OgCardData['replyTypes'],
): OgReplyType | null {
  let best: OgReplyType | null = null
  let bestCount = 0
  for (const type of VERDICT_ORDER) {
    const count = replyTypes.filter((t) => t === type).length
    if (count > bestCount) {
      best = type
      bestCount = count
    }
  }
  return best
}

/**
 * A short, URL-safe version of the og.png card: it changes whenever what the card
 * shows changes (or OG_CARD_LAYOUT is bumped). og:image carries it as ?v=, so a
 * share preview fetches a new image when, say, the first reply comes in; the
 * route sends it as the ETag.
 */
export function ogImageVersion({
  status,
  replyTypes,
  replyRequestCount,
}: OgCardData) {
  const key = [
    OG_CARD_LAYOUT,
    status ?? '',
    ogVerdict(replyTypes) ?? '',
    replyRequestCount ?? 0,
  ].join('|')
  // FNV-1a, 32-bit: only needs to change with the key, not to be secret.
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
