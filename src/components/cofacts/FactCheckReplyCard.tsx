import type { ReplyType } from '@/components/icons/StatusIcon'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { FactCheckReplyTitle } from '@/components/FactCheckReplyTitle'
import { replyTypes } from '@/components/icons/StatusIcon'

/**
 * One existing fact-check response.
 *
 * Props are plain scalars on purpose. The same response reaches this component
 * from two unrelated shapes — the agent's `get_single_cofacts_article` tool
 * result in RightDrawer, and a GraphQL query in the report flow — and picking
 * either one as the prop type would force the other caller to fake it.
 */
export interface FactCheckReplyCardProps {
  /** A rumors-api ReplyTypeEnum value. */
  type: string
  text: string
  /** Sources the responder cited. Often empty. */
  reference?: string | null
  authorName?: string | null
  helpfulCount: number
  unhelpfulCount: number
}

function isReplyType(type: string): type is ReplyType {
  return (replyTypes as ReadonlyArray<string>).includes(type)
}

export function FactCheckReplyCard({
  type,
  text,
  reference,
  authorName,
  helpfulCount,
  unhelpfulCount,
}: FactCheckReplyCardProps) {
  return (
    <div className="flex flex-col gap-spacing-8 rounded-radius-10 border border-border-subtle bg-surface-raised p-spacing-12">
      {/* A verdict added to rumors-api later still shows, as its raw enum value, instead of blank. */}
      {isReplyType(type) ? (
        <FactCheckReplyTitle type={type} />
      ) : (
        <p className="text-type-ui-m-bold text-text-secondary">{type}</p>
      )}
      <p className="text-type-body-s whitespace-pre-wrap text-text-primary">
        {text}
      </p>
      {reference && (
        <p className="text-type-caption whitespace-pre-wrap text-text-tertiary">
          {reference}
        </p>
      )}
      <div className="flex items-center gap-spacing-8 text-type-caption text-text-tertiary">
        {authorName && <span>{authorName}</span>}
        <span className="flex items-center gap-spacing-2">
          <MaterialIcon name="thumb_up" size={20} />
          {helpfulCount}
        </span>
        <span className="flex items-center gap-spacing-2">
          <MaterialIcon name="thumb_down" size={20} />
          {unhelpfulCount}
        </span>
      </div>
    </div>
  )
}
