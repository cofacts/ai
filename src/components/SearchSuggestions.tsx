import { useEffect, useRef } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useChat } from '@/hooks/useChat'
import { getSearchWidget } from '@/lib/chatSessions.functions'

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
  toolCallId,
  className,
}: {
  toolCallId: string
  className?: string
}) {
  const { sessionId } = useParams({ strict: false })
  const { toolInvocations } = useChat({ sessionId: sessionId ?? '' })
  const hasResponse =
    toolCallId in toolInvocations && toolInvocations[toolCallId].resp != null
  const { data: html } = useQuery({
    queryKey: ['search-widget', sessionId, toolCallId],
    queryFn: () =>
      getSearchWidget({ data: { sessionId: sessionId ?? '', toolCallId } }),
    enabled: hasResponse,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!html) return
    const host = hostRef.current
    if (!host) return
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    // SECURITY — trusted content, intentionally rendered via innerHTML (no sanitization):
    // `html` is Gemini's grounding `searchEntryPoint.renderedContent`, a first-party
    // Google payload (styled chips + a `<style>` block). It never contains user input —
    // it travels Gemini API -> our backend artifact -> here, with no untrusted source on
    // the path — and Google's docs prescribe rendering it directly. Any query text inside
    // the chips is HTML-escaped by Google. Note `innerHTML` does not execute injected
    // `<script>` tags. Do NOT run this through a sanitizer like DOMPurify: it would strip
    // the `<style>`/markup the widget needs and break the pills.
    shadow.innerHTML = html
    for (const anchor of Array.from(shadow.querySelectorAll('a'))) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  }, [html])

  if (!html) return null

  return <div ref={hostRef} className={className} />
}
