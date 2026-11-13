/**
 * The user-editable fact-check reply draft («需要你做的事», cofacts/ai).
 *
 * The writer proposes drafts with `draft_factcheck_response`; the right drawer shows them. The
 * user may edit the LATEST successful draft and submit it to Cofacts under their own account.
 * Two rules tie the edits to the chat:
 *
 * 1. Only the latest draft is editable. A draft locks once the user's in-progress edits to it
 *    have been sent to the AI with a chat message, once a newer draft replaces it, and while
 *    the AI is answering (it may be about to propose a newer one).
 * 2. When the user sends a chat message while holding unsent edits, the edited draft is
 *    attached to the message as one extra text part (`formatEditedDraftPart`), so the writer
 *    revises from the user's version. The part names the draft it was based on, which is how a
 *    reloaded session knows that draft is locked (`lockedDraftIds`).
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

// ── Which Cofacts article the session is about ───────────────────

/**
 * The Cofacts article this chat is fact-checking: the last `get_single_cofacts_article` call
 * that found one. `toolInvocations` keeps insertion (= chronological) order. Null when the user
 * pasted a message that is not on Cofacts, in which case there is nothing to reply to.
 */
export function findArticleId(
  toolInvocations: Record<string, ToolInvocation>,
): string | null {
  let articleId: string | null = null
  for (const inv of Object.values(toolInvocations)) {
    if (inv.name !== 'get_single_cofacts_article') continue
    const id = inv.resp?.article?.id
    if (id) articleId = id
  }
  return articleId
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
