import { describe, expect, test } from 'vitest'
import { INITIAL_CHAT_STATE, applyEventToState } from '../chatCache'
import {
  blockDiff,
  draftButtonsByMessage,
  draftSubmitProblem,
  draftTargetArticleIds,
  draftTargetProblem,
  formatEditedDraftPart,
  lookedUpArticles,
  parseEditedDraftPart,
} from '../factCheckDraft'
import type { AdkEvent, ChatMessage, ToolInvocation } from '../adk'
import type { DraftFields } from '../factCheckDraft'

const fields: DraftFields = {
  classification: 'RUMOR',
  text: '第一段\n\n第二段 </text> 不會打斷',
  references: 'https://a.example 摘要\nhttps://b.example 摘要',
}

describe('edited draft part', () => {
  test('round-trips through format / parse', () => {
    const text = formatEditedDraftPart('adk-123', fields)
    expect(parseEditedDraftPart(text)).toEqual({
      basedOn: 'adk-123',
      fields,
    })
  })

  test('keeps empty fields', () => {
    const empty: DraftFields = {
      classification: null,
      text: '',
      references: '',
    }
    expect(
      parseEditedDraftPart(formatEditedDraftPart('adk-1', empty))?.fields,
    ).toEqual(empty)
  })

  test('ignores ordinary text', () => {
    expect(parseEditedDraftPart('請幫我改短一點')).toBeNull()
  })
})

describe('draftSubmitProblem', () => {
  test('a complete draft can be submitted', () => {
    expect(draftSubmitProblem(fields)).toBeNull()
  })
  test('needs a classification and text', () => {
    expect(draftSubmitProblem({ ...fields, classification: null })).toBeTruthy()
    expect(draftSubmitProblem({ ...fields, text: '  ' })).toBeTruthy()
  })
  test('references are required except for NOT_ARTICLE', () => {
    expect(draftSubmitProblem({ ...fields, references: '' })).toBeTruthy()
    expect(
      draftSubmitProblem({
        ...fields,
        classification: 'NOT_ARTICLE',
        references: '',
      }),
    ).toBeNull()
  })
})

const lookup = (
  id: string,
  articleId: string,
  found = true,
  text: string | null = `訊息 ${articleId}`,
) => ({
  id,
  name: 'get_single_cofacts_article',
  args: { article_id: articleId },
  resp: found
    ? {
        article_id: articleId,
        article: { id: articleId, text },
      }
    : { article_id: articleId, error: 'not found' },
})

describe('lookedUpArticles', () => {
  test('lists found articles once, in first-lookup order', () => {
    const invocations = {
      a: lookup('a', 'A1'),
      b: lookup('b', 'missing', false),
      c: lookup('c', 'B2'),
      d: lookup('d', 'A1'),
    } as unknown as Record<string, ToolInvocation>
    expect(lookedUpArticles(invocations)).toEqual([
      { id: 'A1', text: '訊息 A1' },
      { id: 'B2', text: '訊息 B2' },
    ])
    expect(lookedUpArticles({})).toEqual([])
  })

  test('an article without text (image, video) gets empty text', () => {
    const invocations = {
      a: lookup('a', 'IMG', true, null),
    } as unknown as Record<string, ToolInvocation>
    expect(lookedUpArticles(invocations)).toEqual([{ id: 'IMG', text: '' }])
  })
})

describe('draftTargetArticleIds', () => {
  const one = [{ id: 'A1', text: '' }]
  const two = [...one, { id: 'B2', text: '' }]

  test("uses the writer's article_ids, deduplicated", () => {
    expect(
      draftTargetArticleIds({ article_ids: ['B2', 'B2', 'C3'] }, two),
    ).toEqual(['B2', 'C3'])
  })

  test('an empty list means not on Cofacts, never the looked-up article', () => {
    // The writer may have opened a similar article for a pasted message.
    expect(draftTargetArticleIds({ article_ids: [] }, one)).toEqual([])
  })

  test('a draft from before article_ids falls back only to a single looked-up article', () => {
    expect(draftTargetArticleIds({}, one)).toEqual(['A1'])
    // A similar article the writer looked at must never become the target by guessing.
    expect(draftTargetArticleIds({}, two)).toEqual([])
    expect(draftTargetArticleIds({}, [])).toEqual([])
  })

  test('explains why there is no target', () => {
    expect(draftTargetProblem(['A1'], one)).toBeNull()
    expect(draftTargetProblem([], [])).toMatch(/沒有對應的 Cofacts 訊息/)
    expect(draftTargetProblem([], two)).toMatch(/沒有指定/)
    const eleven = Array.from({ length: 11 }, (_, i) => `A${i}`)
    expect(draftTargetProblem(eleven, one)).toMatch(/最多只能送到 10 則/)
  })
})

describe('applyEventToState / sentDraftEdits', () => {
  const userEvent = (text: string): AdkEvent =>
    ({
      author: 'user',
      content: { role: 'user', parts: [{ text }] },
    }) as unknown as AdkEvent

  test('a user message carrying edits records them under the draft they were based on', () => {
    const state = applyEventToState(
      INITIAL_CHAT_STATE,
      userEvent(formatEditedDraftPart('adk-9', fields)),
    )
    expect(state.sentDraftEdits).toEqual({ 'adk-9': fields })
    expect(state.messages).toHaveLength(1)
  })

  test('the latest edits sent for a draft win', () => {
    const newer = { ...fields, text: '再改一次' }
    let state = applyEventToState(
      INITIAL_CHAT_STATE,
      userEvent(formatEditedDraftPart('adk-9', fields)),
    )
    state = applyEventToState(
      state,
      userEvent(formatEditedDraftPart('adk-9', newer)),
    )
    expect(state.sentDraftEdits['adk-9']).toEqual(newer)
  })

  test('an ordinary user message records nothing', () => {
    const state = applyEventToState(INITIAL_CHAT_STATE, userEvent('hi'))
    expect(state.sentDraftEdits).toEqual({})
  })
})

describe('draftButtonsByMessage', () => {
  const user = (id: string): ChatMessage => ({
    id,
    role: 'user',
    author: 'user',
    parts: [{ text: 'q' }],
  })
  const agent = (id: string, callIds: Array<string> = []): ChatMessage => ({
    id,
    role: 'model',
    author: 'writer',
    parts: [
      { text: 'a' },
      ...callIds.map((callId) => ({
        functionCall: { id: callId, name: 'draft_factcheck_response' },
      })),
    ],
  })
  const draft = (id: string, success: boolean) =>
    ({
      id,
      name: 'draft_factcheck_response',
      args: {},
      resp: { success, text: '' },
    }) as ToolInvocation
  const invocations = {
    ok1: draft('ok1', true),
    ok2: draft('ok2', true),
    bad: draft('bad', false),
  }

  test("puts the turn's last passed draft on the turn's last agent message", () => {
    const messages = [
      user('u1'),
      agent('a1', ['ok1']),
      agent('a2', ['ok2']),
      agent('a3', ['bad']),
      agent('a4'),
      user('u2'),
      agent('a5'),
    ]
    expect([...draftButtonsByMessage(messages, invocations, false)]).toEqual([
      ['a4', 'ok2'],
    ])
  })

  test('the last turn gets its button only once streaming ends', () => {
    const messages = [user('u1'), agent('a1', ['ok1']), agent('a2')]
    expect(draftButtonsByMessage(messages, invocations, true).size).toBe(0)
    expect([...draftButtonsByMessage(messages, invocations, false)]).toEqual([
      ['a2', 'ok1'],
    ])
  })

  test('a turn whose drafts all failed gets no button', () => {
    const messages = [user('u1'), agent('a1', ['bad'])]
    expect(draftButtonsByMessage(messages, invocations, false).size).toBe(0)
  })
})

describe('blockDiff', () => {
  test('marks an added paragraph', () => {
    expect(blockDiff('A\n\nB', 'A\n\nB\n\nC', 'paragraph')).toEqual([
      { kind: 'same', text: 'A' },
      { kind: 'same', text: 'B' },
      { kind: 'added', text: 'C' },
    ])
  })
  test('shows a rewritten line as removed then added', () => {
    expect(blockDiff('x\ny\nz', 'x\nY\nz', 'line')).toEqual([
      { kind: 'same', text: 'x' },
      { kind: 'removed', text: 'y' },
      { kind: 'added', text: 'Y' },
      { kind: 'same', text: 'z' },
    ])
  })
  test('lists removals before additions when several blocks change in a row', () => {
    // A rewritten paragraph, a deleted one and an added one, as in a real edit.
    expect(blockDiff('A\n\nB\n\nC', 'A\n\nB2\n\nD', 'paragraph')).toEqual([
      { kind: 'same', text: 'A' },
      { kind: 'removed', text: 'B' },
      { kind: 'removed', text: 'C' },
      { kind: 'added', text: 'B2' },
      { kind: 'added', text: 'D' },
    ])
  })
  test('marks a removed paragraph', () => {
    expect(blockDiff('A\n\nB', 'B', 'paragraph')).toEqual([
      { kind: 'removed', text: 'A' },
      { kind: 'same', text: 'B' },
    ])
  })
})
