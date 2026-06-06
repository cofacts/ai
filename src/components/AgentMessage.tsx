import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import type { ChatMessage, ToolInvocation } from '@/lib/adk'
import { cn } from '@/lib/utils'
import { useSearchWidget } from '@/hooks/useSearchWidget'

interface AgentMessageProps {
  message: ChatMessage
  showAvatar?: boolean
  focusedToolCallId?: string | null
  onToolBadgeClick?: (id: string) => void
  sessionId?: string
  toolInvocations?: Record<string, ToolInvocation>
}

/**
 * Google Search suggestion pills shown to the right of an investigator badge.
 * Fetches the widget artifact for this tool-call once the call has completed.
 */
function InvestigatorBadgePills({
  sessionId,
  toolCallId,
  enabled,
}: {
  sessionId?: string
  toolCallId: string
  enabled: boolean
}) {
  const html = useSearchWidget(sessionId, toolCallId, enabled)
  if (!html) return null
  return (
    <SearchSuggestions html={html} className="flex-1 min-w-0 overflow-x-auto" />
  )
}

export function AgentMessage({
  message,
  showAvatar = true,
  focusedToolCallId,
  onToolBadgeClick,
  sessionId,
  toolInvocations,
}: AgentMessageProps) {
  return (
    <div className="flex flex-col items-start w-full">
      {/* Agent header */}
      {showAvatar && (
        <div className="flex items-center gap-2 mb-2 md:mb-3">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm text-yellow-700">
              smart_toy
            </span>
          </div>
          <span className="text-sm font-semibold text-gray-900">
            {message.author === 'investigator'
              ? 'AI Investigator'
              : message.author === 'verifier'
                ? 'AI Verifier'
                : 'Cofacts AI Agent'}
          </span>
        </div>
      )}

      {/* Message content */}
      <div className="w-full text-text-main leading-7 text-sm max-w-none space-y-2">
        {message.parts?.map((part, i) => {
          if (part.text) {
            return (
              <div key={i} className="prose prose-sm max-w-none prose-p:my-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {part.text}
                </ReactMarkdown>
              </div>
            )
          }

          if (part.functionCall) {
            const { id, name } = part.functionCall
            const isFocused = !!id && id === focusedToolCallId
            const isInvestigator = name === 'investigator'
            return (
              <div key={i} className="flex items-center gap-2 pl-1">
                <span className="material-symbols-outlined text-gray-300 text-xs">
                  subdirectory_arrow_right
                </span>
                <button
                  className={cn(
                    'tool-badge transition-all shrink-0',
                    isFocused
                      ? 'bg-primary/10 ring-1 ring-primary/40'
                      : 'hover:bg-gray-200',
                  )}
                  onClick={() => onToolBadgeClick?.(id ?? '')}
                >
                  <span className="material-symbols-outlined text-[14px] text-gray-500">
                    {name?.toLowerCase()?.includes('search')
                      ? 'search'
                      : name?.toLowerCase()?.includes('verify') ||
                          name?.toLowerCase()?.includes('check')
                        ? 'shield'
                        : name?.toLowerCase()?.includes('cofacts')
                          ? 'fact_check'
                          : 'build'}
                  </span>
                  <span>{name}</span>
                </button>
                {isInvestigator && id && (
                  <InvestigatorBadgePills
                    sessionId={sessionId}
                    toolCallId={id}
                    enabled={toolInvocations?.[id]?.resp != null}
                  />
                )}
              </div>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
