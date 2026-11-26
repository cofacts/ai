import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

export type ExpandableTextProps = {
  children: string
  /**
   * The line clamp while collapsed, per breakpoint, matching the Penpot text box the text sits
   * in, e.g. `line-clamp-8 md:line-clamp-3`.
   */
  clampClassName: string
  /**
   * The text's id, for a caller that points at it, e.g. a link's `aria-describedby`. Generated
   * when not given.
   */
  id?: string
  className?: string
}

/**
 * Text clamped to a few lines with 閱讀全文 under it, as in Penpot's FactCheckReply and
 * FactCheckCard. The button only shows when the text is cut off; once expanded it reads
 * 收合全文, rumors-site's wording, since Penpot doesn't draw the expanded state. It always starts
 * collapsed, as on rumors-site.
 *
 * Collapsed, line breaks in the text read as spaces, as in rumors-site's lists, so every clamped
 * line holds text. Kept, a blank line between paragraphs could take the last clamped line and
 * leave the … alone on it. Expanded, the line breaks show, so a long message keeps its paragraphs.
 */
export function ExpandableText({
  children,
  clampClassName,
  id,
  className,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  // Starts false so a short text never shows 閱讀全文; a long one gets it once measured.
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const collapsing = useRef(false)
  const generatedId = useId()
  const textId = id ?? generatedId

  // Collapsing a long text from its end leaves the page scrolled past the card, with the next
  // card in view. If the card's top is out of view, scroll it back to the top before the
  // browser paints, so the title, the clamped text and 閱讀全文 show. scrollIntoView keeps
  // clear of the page's scroll-padding-top (the sticky nav), so the check does too.
  useLayoutEffect(() => {
    if (expanded || !collapsing.current) return
    collapsing.current = false
    const card = buttonRef.current?.closest('article')
    if (!card) return
    const padding =
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) ||
      0
    if (card.getBoundingClientRect().top < padding) {
      card.scrollIntoView({ block: 'start' })
    }
  }, [expanded])

  useEffect(() => {
    const el = textRef.current
    if (!el || expanded) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [expanded, children])

  return (
    <div className={cn('flex flex-col items-start', className)}>
      <p
        ref={textRef}
        id={textId}
        className={cn(
          'text-type-body-s wrap-anywhere text-text-primary md:text-type-body-m',
          expanded ? 'whitespace-pre-line' : clampClassName,
        )}
      >
        {children}
      </p>
      {(clamped || expanded) && (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => {
            collapsing.current = expanded
            setExpanded(!expanded)
          }}
          className="flex items-center gap-spacing-4 text-type-ui-s text-text-link md:text-type-ui-m"
        >
          {expanded ? '收合全文' : '閱讀全文'}
          <MaterialIcon name={expanded ? 'arrow_drop_up' : 'arrow_drop_down'} />
        </button>
      )}
    </div>
  )
}
