import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FactCheckReply } from '../FactCheckReply'
import type { FactCheckReplyProps } from '../FactCheckReply'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-06T12:00:00+08:00')

const props: FactCheckReplyProps = {
  replyType: 'RUMOR',
  author: {
    name: 'Jack5566',
    avatarUrl: null,
    avatarType: 'Gravatar',
    avatarData: null,
    level: 11,
  },
  text: '假的。',
  createdAt: new Date(NOW - DAY - 60_000).toISOString(),
  now: new Date(NOW).toISOString(),
  citationCount: 2,
  feedback: { positiveCount: 100, negativeCount: 100, ownVote: null },
}

const render = (override: Partial<FactCheckReplyProps> = {}) =>
  renderToStaticMarkup(<FactCheckReply {...props} {...override} />)

describe('FactCheckReply', () => {
  it('counts 「N 天前」 from now, not from the clock', () => {
    expect(render()).toContain('1 天前')
  })

  it.each([
    ['RUMOR', '含有不實訊息'],
    ['NOT_RUMOR', '含有正確訊息'],
    ['OPINIONATED', '含有個人意見'],
    ['NOT_ARTICLE', '不在查證範圍'],
  ] as const)('shows the %s result in the title', (replyType, title) => {
    expect(render({ replyType })).toContain(title)
  })

  it('drops the date part, not the card, when createdAt is unparseable', () => {
    const html = render({ createdAt: 'not a date' })
    expect(html).not.toContain('回應於')
    expect(html).toContain('被引用 2 次')
  })

  it('shows 資料佐證 only for with-link', () => {
    const reference = '見 https://example.com/a。'
    expect(render({ reference })).not.toContain('資料佐證')
    const html = render({ variant: 'with-link', reference })
    expect(html).toContain('資料佐證')
    expect(html).toContain('href="https://example.com/a"')
  })

  it('renders one HyperlinkPreview per link', () => {
    const html = render({
      variant: 'with-link',
      hyperlinks: [
        { url: 'https://example.com/a', title: 'A' },
        { url: 'https://example.com/b', title: 'B' },
      ],
    })
    expect(html).toContain('href="https://example.com/a"')
    expect(html).toContain('href="https://example.com/b"')
  })
})
