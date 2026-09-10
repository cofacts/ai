// Cofacts' four verdicts, and how they look.
//
// Shared by everything that shows an existing fact-check response, so the same
// verdict never appears in two different colours in two different places.

export interface ReplyTypeInfo {
  label: string
  className: string
}

const REPLY_TYPE_INFO: Record<string, ReplyTypeInfo> = {
  RUMOR: {
    label: '含有不實訊息',
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
  NOT_RUMOR: {
    label: '不含不實訊息',
    className: 'bg-green-50 text-green-700 border border-green-200',
  },
  OPINIONATED: {
    label: '含有個人意見',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  NOT_ARTICLE: {
    label: '不是可查核的內容',
    className: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  },
}

/**
 * Falls back to showing the raw enum value rather than hiding it: a verdict
 * added to rumors-api later should still be legible here, not blank.
 */
export function getReplyTypeInfo(type: string): ReplyTypeInfo {
  return (
    REPLY_TYPE_INFO[type] ?? {
      label: type,
      className: 'bg-gray-50 text-gray-700 border border-gray-200',
    }
  )
}
