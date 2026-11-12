import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HyperlinkPreview } from '../HyperlinkPreview'

const renderHtml = (url: string, topImageUrl?: string) =>
  renderToStaticMarkup(
    <HyperlinkPreview hyperlink={{ url, title: 'Title', topImageUrl }} />,
  )

describe('HyperlinkPreview', () => {
  it('links http(s) urls and opens them in a new tab', () => {
    const html = renderHtml('https://example.com/a')
    expect(html).toContain('<a ')
    expect(html).toContain('href="https://example.com/a"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('（另開新分頁）')
  })

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'not a url'])(
    'shows %s as text, never as a link',
    (url) => {
      const html = renderHtml(url)
      expect(html).not.toContain('<a ')
      expect(html).not.toContain('href=')
    },
  )

  it('shows topImageUrl as a decorative image that sends no referrer', () => {
    const html = renderHtml(
      'https://example.com/a',
      'https://example.com/a.jpg',
    )
    expect(html).toContain('src="https://example.com/a.jpg"')
    expect(html).toContain('alt=""')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('loading="lazy"')
  })

  it.each(['javascript:alert(1)', 'data:image/png;base64,AA', 'not a url'])(
    'shows no image for topImageUrl %s',
    (topImageUrl) => {
      expect(renderHtml('https://example.com/a', topImageUrl)).not.toContain(
        '<img',
      )
    },
  )
})
