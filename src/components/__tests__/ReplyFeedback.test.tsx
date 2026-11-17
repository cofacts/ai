// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { sortReasons } from '../ReplyFeedback'
import type { ReplyFeedbackReason } from '../ReplyFeedback'

const reason = (
  id: string,
  overrides: Partial<ReplyFeedbackReason> = {},
): ReplyFeedbackReason => ({
  id,
  vote: 'UPVOTE',
  comment: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  user: null,
  ...overrides,
})

describe('sortReasons', () => {
  it('keeps only the feedbacks of the given vote', () => {
    const result = sortReasons(
      [reason('up', { vote: 'UPVOTE' }), reason('down', { vote: 'DOWNVOTE' })],
      'DOWNVOTE',
    )
    expect(result.map((r) => r.id)).toEqual(['down'])
  })

  it('puts feedbacks with a comment first, then newest first within each group', () => {
    const result = sortReasons(
      [
        reason('old-empty', { createdAt: '2026-01-01T00:00:00.000Z' }),
        reason('new-empty', { createdAt: '2026-03-01T00:00:00.000Z' }),
        reason('old-comment', {
          comment: 'a',
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
        reason('new-comment', {
          comment: 'b',
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
      ],
      'UPVOTE',
    )
    expect(result.map((r) => r.id)).toEqual([
      'new-comment',
      'old-comment',
      'new-empty',
      'old-empty',
    ])
  })

  it('treats a comment of only whitespace as no comment', () => {
    const result = sortReasons(
      [
        reason('blank', {
          comment: '  \n ',
          createdAt: '2026-03-01T00:00:00.000Z',
        }),
        reason('real', {
          comment: 'text',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
      'UPVOTE',
    )
    expect(result.map((r) => r.id)).toEqual(['real', 'blank'])
  })

  it('does not change the array it is given', () => {
    const input = [
      reason('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      reason('b', { createdAt: '2026-02-01T00:00:00.000Z' }),
    ]
    sortReasons(input, 'UPVOTE')
    expect(input.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
