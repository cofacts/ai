import { describe, expect, test } from 'vitest'
import {
  INITIAL_CHAT_STATE,
  applyEventToState,
  getDraftVersionsById,
} from '../chatCache'
import type { AdkEvent, ChatMessage } from '../adk'

/**
 * draft_factcheck_response is re-callable (cofacts/ai#117): the writer may
 * submit several proposals per turn, and only a SUCCESSFUL one should ever
 * become `lastReplyDraftId` (the one the drawer auto-pops when the turn
 * ends) -- a gate-rejected proposal (missing sources, unconfirmed claims,
 * etc.) must not overwrite a prior good draft.
 */

function draftCallEvent(id: string, text: string): AdkEvent {
  return {
    author: 'writer',
    content: {
      role: 'model',
      parts: [
        {
          functionCall: {
            id,
            name: 'draft_factcheck_response',
            args: { text, classification: 'RUMOR', references: 'https://x' },
          },
        },
      ],
    },
  } as unknown as AdkEvent
}

function draftResponseEvent(id: string, success: boolean): AdkEvent {
  return {
    author: 'writer',
    content: {
      role: 'user',
      parts: [
        {
          functionResponse: {
            id,
            name: 'draft_factcheck_response',
            response: { success, text: success ? 'ok' : 'rejected: fix x' },
          },
        },
      ],
    },
  } as unknown as AdkEvent
}

describe('applyEventToState / lastReplyDraftId', () => {
  test('a function_call alone does not set lastReplyDraftId', () => {
    const state = applyEventToState(
      INITIAL_CHAT_STATE,
      draftCallEvent('fc-1', 'draft v1'),
    )
    expect(state.lastReplyDraftId).toBeNull()
  })

  test('a successful function_response sets lastReplyDraftId', () => {
    let state = applyEventToState(
      INITIAL_CHAT_STATE,
      draftCallEvent('fc-1', 'draft v1'),
    )
    state = applyEventToState(state, draftResponseEvent('fc-1', true))
    expect(state.lastReplyDraftId).toBe('fc-1')
  })

  test('a rejected (gate-failed) function_response does NOT set lastReplyDraftId', () => {
    let state = applyEventToState(
      INITIAL_CHAT_STATE,
      draftCallEvent('fc-1', 'draft v1'),
    )
    state = applyEventToState(state, draftResponseEvent('fc-1', false))
    expect(state.lastReplyDraftId).toBeNull()
  })

  test('a rejected proposal after a prior success does not clobber the prior successful draft id', () => {
    let state = applyEventToState(
      INITIAL_CHAT_STATE,
      draftCallEvent('fc-1', 'draft v1'),
    )
    state = applyEventToState(state, draftResponseEvent('fc-1', true))
    state = applyEventToState(state, draftCallEvent('fc-2', 'draft v2 (bad)'))
    state = applyEventToState(state, draftResponseEvent('fc-2', false))
    expect(state.lastReplyDraftId).toBe('fc-1')
  })

  test('a second successful proposal updates lastReplyDraftId to the newer call', () => {
    let state = applyEventToState(
      INITIAL_CHAT_STATE,
      draftCallEvent('fc-1', 'draft v1'),
    )
    state = applyEventToState(state, draftResponseEvent('fc-1', true))
    state = applyEventToState(state, draftCallEvent('fc-2', 'draft v2'))
    state = applyEventToState(state, draftResponseEvent('fc-2', true))
    expect(state.lastReplyDraftId).toBe('fc-2')
  })

  test('function_response for an unrelated tool never sets lastReplyDraftId', () => {
    let state = applyEventToState(INITIAL_CHAT_STATE, {
      author: 'writer',
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'fc-9',
              name: 'search_cofacts_database',
              args: {},
            },
          },
        ],
      },
    } as unknown as AdkEvent)
    state = applyEventToState(state, {
      author: 'writer',
      content: {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'fc-9',
              name: 'search_cofacts_database',
              response: { success: true },
            },
          },
        ],
      },
    } as unknown as AdkEvent)
    expect(state.lastReplyDraftId).toBeNull()
  })
})

describe('getDraftVersionsById', () => {
  test('empty messages yields an empty map', () => {
    expect(getDraftVersionsById([])).toEqual({})
  })

  test('numbers draft_factcheck_response calls in submission order across messages', () => {
    const messages: Array<ChatMessage> = [
      {
        id: 'm1',
        role: 'model',
        parts: [
          { functionCall: { id: 'fc-1', name: 'draft_factcheck_response' } },
        ],
      },
      {
        id: 'm2',
        role: 'model',
        parts: [
          { functionCall: { id: 'fc-2', name: 'search_cofacts_database' } },
        ],
      },
      {
        id: 'm3',
        role: 'model',
        parts: [
          { functionCall: { id: 'fc-3', name: 'draft_factcheck_response' } },
        ],
      },
    ]
    expect(getDraftVersionsById(messages)).toEqual({ 'fc-1': 1, 'fc-3': 2 })
  })

  test('multiple draft calls within the same message are still ordered by array position', () => {
    const messages: Array<ChatMessage> = [
      {
        id: 'm1',
        role: 'model',
        parts: [
          { functionCall: { id: 'fc-1', name: 'draft_factcheck_response' } },
          { functionCall: { id: 'fc-2', name: 'draft_factcheck_response' } },
        ],
      },
    ]
    expect(getDraftVersionsById(messages)).toEqual({ 'fc-1': 1, 'fc-2': 2 })
  })

  test('a function_call with no id is skipped', () => {
    const messages: Array<ChatMessage> = [
      {
        id: 'm1',
        role: 'model',
        parts: [{ functionCall: { name: 'draft_factcheck_response' } }],
      },
    ]
    expect(getDraftVersionsById(messages)).toEqual({})
  })
})
