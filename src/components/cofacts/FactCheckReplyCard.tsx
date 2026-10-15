import { getReplyTypeInfo } from './replyTypes'

/**
 * One existing fact-check response.
 *
 * Props are plain scalars on purpose. The same response reaches this component
 * from two unrelated shapes — the agent's `get_single_cofacts_article` tool
 * result in RightDrawer, and a GraphQL query in the report flow — and picking
 * either one as the prop type would force the other caller to fake it.
 */
export interface FactCheckReplyCardProps {
  type: string
  text: string
  /** Sources the responder cited. Often empty. */
  reference?: string | null
  authorName?: string | null
  helpfulCount: number
  unhelpfulCount: number
}

export function FactCheckReplyCard({
  type,
  text,
  reference,
  authorName,
  helpfulCount,
  unhelpfulCount,
}: FactCheckReplyCardProps) {
  const typeInfo = getReplyTypeInfo(type)

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
      <span
        className={`inline-block text-[10px] font-bold rounded px-1.5 py-0.5 ${typeInfo.className}`}
      >
        {typeInfo.label}
      </span>
      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
        {text}
      </p>
      {reference && (
        <p className="text-xs text-gray-400 whitespace-pre-wrap">{reference}</p>
      )}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {authorName && <span>{authorName}</span>}
        <span className="flex items-center gap-0.5">
          <span className="material-symbols-outlined text-xs">thumb_up</span>
          {helpfulCount}
        </span>
        <span className="flex items-center gap-0.5">
          <span className="material-symbols-outlined text-xs">thumb_down</span>
          {unhelpfulCount}
        </span>
      </div>
    </div>
  )
}
