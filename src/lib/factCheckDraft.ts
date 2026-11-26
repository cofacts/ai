/**
 * The user-editable fact-check reply draft («需要你做的事», cofacts/ai).
 *
 * The writer proposes drafts with `draft_factcheck_response`; the right drawer shows them. The
 * user may edit the LATEST successful draft and submit it to Cofacts under their own account.
 * Two rules tie the edits to the chat:
 *
 * 1. Only the latest draft is editable, and only once the AI's turn has ended. A draft locks
 *    while the AI is answering (it may be about to propose a newer one) and once a newer draft
 *    replaces it. Nothing else locks it: if the user's edits went to the AI and no new draft
 *    came back, the draft stays editable.
 * 2. When the user sends a chat message while holding unsent edits, the edited draft is
 *    attached to the message as one extra text part (`formatEditedDraftPart`), so the writer
 *    revises from the user's version. The part names the draft it was based on; the drawer
 *    shows that draft as the user last sent it (`sentDraftEdits`), even after reload.
 *
 * The writer names the article(s) each draft replies to (`article_ids`), so a similar article it
 * looked up along the way is never the target (`draftTargetArticleIds`).
 *
 * This file is pure (no React, no storage) so the cache reducer and its tests can use it.
 */

import type { ChatMessage, ToolInvocation } from './adk'

export type ReplyCategory =
  | 'NOT_ARTICLE'
  | 'RUMOR'
  | 'NOT_RUMOR'
  | 'OPINIONATED'

export const REPLY_CATEGORIES: ReadonlyArray<ReplyCategory> = [
  'NOT_ARTICLE',
  'RUMOR',
  'NOT_RUMOR',
  'OPINIONATED',
]

/** How each category is labelled in the drawer and in the chat bubble. */
export const REPLY_CATEGORY_LABELS: Record<ReplyCategory, string> = {
  NOT_ARTICLE: '不在查證範圍',
  RUMOR: '含有不實訊息',
  NOT_RUMOR: '含有正確訊息',
  OPINIONATED: '含有個人意見',
}

export function isReplyCategory(value: unknown): value is ReplyCategory {
  return REPLY_CATEGORIES.includes(value as ReplyCategory)
}

/** The three fields the user can change; also what is submitted to Cofacts. */
export interface DraftFields {
  classification: ReplyCategory | null
  text: string
  references: string
}

/** The draft as the AI proposed it, from the tool call's args. */
export function draftFieldsFromArgs(
  args: Extract<ToolInvocation, { name: 'draft_factcheck_response' }>['args'],
): DraftFields {
  return {
    classification: isReplyCategory(args.classification)
      ? args.classification
      : null,
    text: args.text ?? '',
    references: args.references ?? '',
  }
}

export function draftFieldsEqual(a: DraftFields, b: DraftFields): boolean {
  return (
    a.classification === b.classification &&
    a.text === b.text &&
    a.references === b.references
  )
}

/** Why the draft cannot be submitted yet, or null when it can. */
export function draftSubmitProblem(fields: DraftFields): string | null {
  if (!fields.classification) return '請先選擇這則訊息的分類'
  if (!fields.text.trim()) return '回應內容不能是空白'
  // rumors-api's CreateReply: "reference is required for type !== NOT_ARTICLE".
  if (fields.classification !== 'NOT_ARTICLE' && !fields.references.trim())
    return '除了「不在查證範圍」以外，都需要附上佐證資料'
  return null
}

// ── The edited draft attached to a chat message ──────────────────

const EDITED_DRAFT_OPEN = /^<user_edited_draft based_on="([^"]+)">\n/
const EDITED_DRAFT_CLOSE = '\n</user_edited_draft>'

/**
 * Serializes the user's edited draft as a chat-message text part for the writer. The tag and
 * its field labels are what the writer's instruction (`adk/cofacts_ai/agent.py`, "When the
 * User Edits the Draft") describes; change both together.
 */
export function formatEditedDraftPart(
  basedOnDraftId: string,
  fields: DraftFields,
): string {
  return [
    `<user_edited_draft based_on="${basedOnDraftId}">`,
    `classification: ${fields.classification ?? ''}`,
    '<text>',
    fields.text,
    '</text>',
    '<references>',
    fields.references,
    '</references>',
    '</user_edited_draft>',
  ].join('\n')
}

/** Reverses `formatEditedDraftPart`; null for any other text. */
export function parseEditedDraftPart(
  text: string,
): { basedOn: string; fields: DraftFields } | null {
  const open = EDITED_DRAFT_OPEN.exec(text)
  if (!open || !text.endsWith(EDITED_DRAFT_CLOSE)) return null
  const body = text.slice(open[0].length, -EDITED_DRAFT_CLOSE.length)
  const m =
    /^classification: (.*)\n<text>\n([\s\S]*)\n<\/text>\n<references>\n([\s\S]*)\n<\/references>$/.exec(
      body,
    )
  if (!m) return null
  return {
    basedOn: open[1]!,
    fields: {
      classification: isReplyCategory(m[1]) ? m[1] : null,
      text: m[2]!,
      references: m[3]!,
    },
  }
}

// ── Which Cofacts article(s) a draft replies to ──────────────────

export interface LookedUpArticle {
  id: string
  text: string
}

/**
 * Every Cofacts article the chat looked up with `get_single_cofacts_article`, in the order they
 * were first looked up (`toolInvocations` keeps insertion order).
 */
export function lookedUpArticles(
  toolInvocations: Record<string, ToolInvocation>,
): Array<LookedUpArticle> {
  const articles = new Map<string, LookedUpArticle>()
  for (const inv of Object.values(toolInvocations)) {
    if (inv.name !== 'get_single_cofacts_article') continue
    const article = inv.resp?.article
    if (article?.id && !articles.has(article.id))
      // rumors-api's text is null for some image and video articles.
      articles.set(article.id, { id: article.id, text: article.text ?? '' })
  }
  return [...articles.values()]
}

/** The most articles one reply may go to; `draft_factcheck_response` checks the same. */
export const MAX_REPLY_ARTICLES = 10

/**
 * The articles a draft replies to: the writer's `article_ids`. An empty list means the message
 * is not on Cofacts. Only a draft proposed before the tool took `article_ids` falls back, to the
 * only article the chat looked up; with several, its target is unknown and it can't be submitted.
 */
export function draftTargetArticleIds(
  args: Extract<ToolInvocation, { name: 'draft_factcheck_response' }>['args'],
  lookedUp: Array<LookedUpArticle>,
): Array<string> {
  if (args.article_ids === undefined)
    return lookedUp.length === 1 ? [lookedUp[0]!.id] : []
  return [...new Set(args.article_ids.filter(Boolean))]
}

/** Why a draft with these targets cannot be submitted, or null when it can. */
export function draftTargetProblem(
  targetIds: Array<string>,
  lookedUp: Array<LookedUpArticle>,
): string | null {
  if (targetIds.length > MAX_REPLY_ARTICLES)
    return `一則查核回應最多只能送到 ${MAX_REPLY_ARTICLES} 則訊息，請請 AI 減少要回應的訊息。`
  if (targetIds.length > 0) return null
  return lookedUp.length === 0
    ? '這段對話沒有對應的 Cofacts 訊息，無法直接送出。請從 Cofacts 的訊息頁開始查核。'
    : 'AI 沒有指定這份草稿要回應哪一則 Cofacts 訊息，無法送出。請請 AI 重新產生草稿。'
}

// ── The 「查核回應草稿」 button at the end of a turn ─────────────

/**
 * For each chat turn (the agent messages between two user messages) that proposed a draft that
 * passed validation, maps the turn's LAST agent message id to that turn's last passed draft. The
 * message renders a button that opens the draft, so the user doesn't have to scroll back to the
 * tool call. A turn still streaming gets no button yet.
 */
export function draftButtonsByMessage(
  messages: Array<ChatMessage>,
  toolInvocations: Record<string, ToolInvocation>,
  isStreaming: boolean,
): Map<string, string> {
  const result = new Map<string, string>()
  let lastAgentMessageId: string | null = null
  let turnDraftId: string | null = null

  const endTurn = () => {
    if (lastAgentMessageId && turnDraftId)
      result.set(lastAgentMessageId, turnDraftId)
    lastAgentMessageId = null
    turnDraftId = null
  }

  for (const message of messages) {
    if (message.author === 'user') {
      endTurn()
      continue
    }
    lastAgentMessageId = message.id
    for (const part of message.parts ?? []) {
      const id = part.functionCall?.id
      if (!id) continue
      const inv = toolInvocations[id]
      if (inv?.name === 'draft_factcheck_response' && inv.resp?.success)
        turnDraftId = id
    }
  }
  if (!isStreaming) endTurn()
  return result
}

/**
 * What the user's edits did in each chat turn (the agent messages after a user message):
 * - `revisedDraftIds`: passed drafts proposed in a turn whose user message carried the user's
 *   edits, i.e. the AI's revisions of them (every one, if the writer proposed several);
 * - `currentEditedDraftId`: the draft whose edits the latest user message carries, or null.
 */
export function draftEditTurns(
  messages: Array<ChatMessage>,
  toolInvocations: Record<string, ToolInvocation>,
): { revisedDraftIds: Set<string>; currentEditedDraftId: string | null } {
  const revisedDraftIds = new Set<string>()
  let currentEditedDraftId: string | null = null
  for (const message of messages) {
    if (message.author === 'user') {
      currentEditedDraftId = null
      for (const part of message.parts ?? []) {
        const edited = part.text ? parseEditedDraftPart(part.text) : null
        if (edited) currentEditedDraftId = edited.basedOn
      }
      continue
    }
    if (!currentEditedDraftId) continue
    for (const part of message.parts ?? []) {
      const inv = part.functionCall?.id
        ? toolInvocations[part.functionCall.id]
        : undefined
      if (inv?.name === 'draft_factcheck_response' && inv.resp?.success)
        revisedDraftIds.add(inv.id)
    }
  }
  return { revisedDraftIds, currentEditedDraftId }
}

export type DiffSegment = {
  kind: 'same' | 'added' | 'removed'
  text: string
}

/**
 * Compares the AI's version with the user's, block by block, so a locked draft can show the
 * AI's version with the user's changes marked. Reply text is split into paragraphs (blank
 * lines); references, which have one source per line, into lines. A changed block shows as the
 * AI's block removed and the user's added. Longest-common-subsequence over blocks — drafts are a
 * handful of paragraphs, so the quadratic table is tiny.
 */
export function blockDiff(
  original: string,
  edited: string,
  by: 'paragraph' | 'line',
): Array<DiffSegment> {
  const split = (s: string) =>
    (by === 'paragraph' ? s.split(/\n\s*\n/) : s.split('\n'))
      .map((b) => b.trim())
      .filter(Boolean)
  const a = split(original)
  const b = split(edited)
  const lcs: Array<Array<number>> = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)

  const out: Array<DiffSegment> = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (
      j < b.length &&
      (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)
    ) {
      out.push({ kind: 'added', text: b[j]! })
      j++
    } else {
      out.push({ kind: 'removed', text: a[i]! })
      i++
    }
  }
  // Within each run of changes, list what was removed before what was added, the order people
  // read a correction in. One swap pass is not enough: two edits in a row come out of the walk
  // as added, added, removed, removed.
  const ordered: Array<DiffSegment> = []
  let run: Array<DiffSegment> = []
  const flush = () => {
    ordered.push(
      ...run.filter((seg) => seg.kind === 'removed'),
      ...run.filter((seg) => seg.kind === 'added'),
    )
    run = []
  }
  for (const seg of out) {
    if (seg.kind === 'same') {
      flush()
      ordered.push(seg)
    } else run.push(seg)
  }
  flush()
  return ordered
}
