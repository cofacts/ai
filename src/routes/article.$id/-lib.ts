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

export type QuickNavItem = { id: string; label: string }

/**
 * The 本頁索引 entries, in page order. AI 自動分析 is shown only while the
 * article has no fact-check reply, so its entry comes and goes with it.
 */
export function getQuickNavItems({
  replyCount,
}: {
  replyCount: number
}): Array<QuickNavItem> {
  return [
    { id: ARTICLE_SECTION_IDS.replies, label: `查核回應 (${replyCount})` },
    ...(replyCount === 0
      ? [{ id: ARTICLE_SECTION_IDS.aiAnalysis, label: 'AI 自動分析' }]
      : []),
    { id: ARTICLE_SECTION_IDS.similar, label: '相似可疑訊息與組合' },
    { id: ARTICLE_SECTION_IDS.original, label: '原始訊息' },
  ]
}
