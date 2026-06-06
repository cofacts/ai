import { useEffect, useRef } from 'react'

/**
 * Renders Google's Search "suggestion pills" HTML (the grounding
 * `searchEntryPoint.renderedContent`).
 *
 * The HTML ships its own inline `<style>` block with generic class names
 * (`.container`, `.chip`, …), so we mount it inside a Shadow DOM to fully
 * isolate those styles from the surrounding Tailwind app. Links are rewritten to
 * open in a new tab so a pill launches a Google search without navigating away.
 */
export function SearchSuggestions({
  html,
  className,
}: {
  html: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    shadow.innerHTML = html
    for (const anchor of Array.from(shadow.querySelectorAll('a'))) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  }, [html])

  return <div ref={hostRef} className={className} />
}
