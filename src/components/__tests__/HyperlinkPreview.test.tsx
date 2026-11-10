import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HyperlinkPreview } from '../HyperlinkPreview'

const render = (url: string) =>
  renderToStaticMarkup(<HyperlinkPreview hyperlink={{ url, title: 'Title' }} />)

describe('HyperlinkPreview', () => {
  it('links http(s) urls and opens them in a new tab', () => {
    const html = render('https://example.com/a')
    expect(html).toContain('<a ')
    expect(html).toContain('href="https://example.com/a"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('（另開新分頁）')
  })

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'not a url'])(
    'shows %s as text, never as a link',
    (url) => {
      const html = render(url)
      expect(html).not.toContain('<a ')
      expect(html).not.toContain('href=')
    },
  )
})
