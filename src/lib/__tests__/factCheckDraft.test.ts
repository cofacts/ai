import { describe, expect, test } from 'vitest'
import { INITIAL_CHAT_STATE, applyEventToState } from '../chatCache'
import {
  draftButtonsByMessage,
  draftSubmitProblem,
  findArticleId,
  formatEditedDraftPart,
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

describe('findArticleId', () => {
  test('uses the last lookup that found an article', () => {
    const invocations = {
      a: {
        id: 'a',
        name: 'get_single_cofacts_article',
        args: { article_id: 'A1' },
        resp: { article_id: 'A1', article: { id: 'A1' } },
      },
      b: {
        id: 'b',
        name: 'get_single_cofacts_article',
        args: { article_id: 'missing' },
        resp: { article_id: 'missing', error: 'not found' },
      },
    } as unknown as Record<string, ToolInvocation>
    expect(findArticleId(invocations)).toBe('A1')
    expect(findArticleId({})).toBeNull()
  })
})

describe('applyEventToState / lockedDraftIds', () => {
  const userEvent = (text: string): AdkEvent =>
    ({
      author: 'user',
      content: { role: 'user', parts: [{ text }] },
    }) as unknown as AdkEvent

  test('a user message carrying edits locks the draft it was based on', () => {
    const state = applyEventToState(
      INITIAL_CHAT_STATE,
      userEvent(formatEditedDraftPart('adk-9', fields)),
    )
    expect(state.lockedDraftIds).toEqual(['adk-9'])
    expect(state.messages).toHaveLength(1)
  })

  test('an ordinary user message locks nothing', () => {
    const state = applyEventToState(INITIAL_CHAT_STATE, userEvent('hi'))
    expect(state.lockedDraftIds).toEqual([])
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
