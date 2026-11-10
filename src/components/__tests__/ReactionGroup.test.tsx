// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReactionGroup } from '../ReactionGroup'

describe('ReactionGroup', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders with reason variant and accessible names', () => {
    render(
      <ReactionGroup
        type="reason"
        positiveCount={12}
        negativeCount={3}
        ownVote={null}
      />,
    )

    const up = screen.getByRole('button', { name: /有幫助\s*12/ })
    const down = screen.getByRole('button', { name: /沒幫助\s*3/ })
    const reasons = screen.getByRole('button', { name: '看理由' })

    expect(up.getAttribute('aria-pressed')).toBe('false')
    expect(down.getAttribute('aria-pressed')).toBe('false')
    expect(reasons.hasAttribute('aria-pressed')).toBe(false)
  })

  it('renders with report variant and accessible name', () => {
    render(
      <ReactionGroup
        type="report"
        positiveCount={5}
        negativeCount={0}
        ownVote="UPVOTE"
      />,
    )

    const up = screen.getByRole('button', { name: /有幫助\s*5/ })
    const down = screen.getByRole('button', { name: /沒幫助\s*0/ })
    const report = screen.getByRole('button', { name: '檢舉' })

    expect(up.getAttribute('aria-pressed')).toBe('true')
    expect(down.getAttribute('aria-pressed')).toBe('false')
    expect(report).toBeDefined()
  })

  it('calls onVote with UPVOTE or NEUTRAL when clicking upvote', () => {
    const onVote = vi.fn()

    const { rerender } = render(
      <ReactionGroup
        positiveCount={10}
        negativeCount={2}
        ownVote={null}
        onVote={onVote}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /有幫助\s*10/ }))
    expect(onVote).toHaveBeenLastCalledWith('UPVOTE')

    // When already UPVOTE, clicking upvote retracts vote (NEUTRAL)
    rerender(
      <ReactionGroup
        positiveCount={10}
        negativeCount={2}
        ownVote="UPVOTE"
        onVote={onVote}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /有幫助\s*10/ }))
    expect(onVote).toHaveBeenLastCalledWith('NEUTRAL')
  })

  it('calls onVote with DOWNVOTE or NEUTRAL when clicking downvote', () => {
    const onVote = vi.fn()

    const { rerender } = render(
      <ReactionGroup
        positiveCount={10}
        negativeCount={2}
        ownVote="UPVOTE"
        onVote={onVote}
      />,
    )

    // Switching vote to DOWNVOTE
    fireEvent.click(screen.getByRole('button', { name: /沒幫助\s*2/ }))
    expect(onVote).toHaveBeenLastCalledWith('DOWNVOTE')

    // Retracting DOWNVOTE
    rerender(
      <ReactionGroup
        positiveCount={10}
        negativeCount={2}
        ownVote="DOWNVOTE"
        onVote={onVote}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /沒幫助\s*2/ }))
    expect(onVote).toHaveBeenLastCalledWith('NEUTRAL')
  })

  it('calls onShowReasons and onReport callbacks', () => {
    const onShowReasons = vi.fn()
    const onReport = vi.fn()

    const { rerender } = render(
      <ReactionGroup
        type="reason"
        positiveCount={0}
        negativeCount={0}
        onShowReasons={onShowReasons}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '看理由' }))
    expect(onShowReasons).toHaveBeenCalledTimes(1)

    rerender(
      <ReactionGroup
        type="report"
        positiveCount={0}
        negativeCount={0}
        onReport={onReport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '檢舉' }))
    expect(onReport).toHaveBeenCalledTimes(1)
  })

  it('disables vote buttons when voteDisabled is true, keeping last segment enabled', () => {
    render(
      <ReactionGroup
        type="reason"
        positiveCount={1}
        negativeCount={1}
        voteDisabled
      />,
    )

    const up = screen.getByRole<HTMLButtonElement>('button', {
      name: /有幫助\s*1/,
    })
    const down = screen.getByRole<HTMLButtonElement>('button', {
      name: /沒幫助\s*1/,
    })
    const reasons = screen.getByRole<HTMLButtonElement>('button', {
      name: '看理由',
    })

    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(true)
    expect(reasons.disabled).toBe(false)
  })
})
