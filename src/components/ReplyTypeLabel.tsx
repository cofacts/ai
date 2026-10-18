import { StatusIcon } from './StatusIcon'
import type { ReplyType } from './StatusIcon'
import { cn } from '@/lib/utils'

export type { ReplyType }

/** Wording from the a11y guide: always 含有不實訊息, never 含有錯誤訊息. */
export const replyTypeText: Record<ReplyType, string> = {
  RUMOR: '含有不實訊息',
  NOT_RUMOR: '含有正確訊息',
  OPINIONATED: '含有個人意見',
  NOT_ARTICLE: '不在查證範圍',
}

const textClass: Record<ReplyType, string> = {
  RUMOR: 'text-status-incorrect',
  NOT_RUMOR: 'text-status-correct',
  OPINIONATED: 'text-status-opinion',
  NOT_ARTICLE: 'text-status-outofscope',
}

/**
 * Penpot Content/FactCheckReply-Title. A fact-check result is always text + shape + color (R1);
 * this is the one place that turns a reply type into status colors.
 */
export function ReplyTypeLabel({
  type,
  author,
  className,
}: {
  type: ReplyType
  /** Shown as「{author} 認為{type}」. */
  author?: string
  className?: string
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-12 text-heading-xs md:gap-20 md:text-heading-s',
        textClass[type],
        className,
      )}
    >
      <StatusIcon type={type} />
      <span>
        {author && <>{author} 認為</>}
        {replyTypeText[type]}
      </span>
    </p>
  )
}
