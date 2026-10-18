import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import type { ChatMessage } from '@/lib/adk'
import { cn } from '@/lib/utils'

interface AgentMessageProps {
  message: ChatMessage
  showAvatar?: boolean
  focusedToolCallId?: string | null
  onToolBadgeClick?: (id: string) => void
}

export function AgentMessage({
  message,
  showAvatar = true,
  focusedToolCallId,
  onToolBadgeClick,
}: AgentMessageProps) {
  return (
    <div className="flex flex-col items-start w-full">
      {/* Agent header */}
      {showAvatar && (
        <div className="flex items-center gap-8 mb-8 md:mb-12">
          <div className="w-24 h-24 rounded-full bg-accent-subtle flex items-center justify-center">
            <span className="material-symbols-outlined text-body-s text-secondary">
              smart_toy
            </span>
          </div>
          <span className="text-body-s font-bold text-primary">
            {message.author === 'investigator'
              ? 'AI Investigator'
              : message.author === 'verifier'
                ? 'AI Verifier'
                : 'Cofacts AI Agent'}
          </span>
        </div>
      )}

      {/* Message content */}
      <div className="w-full text-primary text-body-s max-w-none space-y-8">
        {message.parts?.map((part, i) => {
          if (part.text) {
            return (
              <div key={i} className="prose prose-sm max-w-none prose-p:my-8">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {part.text}
                </ReactMarkdown>
              </div>
            )
          }

          if (part.functionCall) {
            const { id, name } = part.functionCall
            const lowerName = name?.toLowerCase() ?? ''
            const isFocused = !!id && id === focusedToolCallId
            const isInvestigator = name === 'investigator'
            return (
              <div key={i} className="flex items-center gap-8 pl-4">
                <span className="material-symbols-outlined text-disabled text-caption">
                  subdirectory_arrow_right
                </span>
                <button
                  className={cn(
                    'inline-flex shrink-0 cursor-pointer items-center gap-6 rounded-full border border-subtle bg-raised px-10 py-2 my-4 font-mono text-caption text-secondary transition-all hover:bg-selected hover:text-primary',
                    isFocused ? 'bg-accent-subtle' : 'hover:bg-selected',
                  )}
                  onClick={() => onToolBadgeClick?.(id ?? '')}
                >
                  <span className="material-symbols-outlined text-[14px] text-tertiary">
                    {lowerName.includes('search')
                      ? 'search'
                      : lowerName.includes('verify') ||
                          lowerName.includes('check')
                        ? 'shield'
                        : lowerName.includes('cofacts')
                          ? 'fact_check'
                          : 'build'}
                  </span>
                  <span>{name}</span>
                </button>
                {isInvestigator && id && (
                  <SearchSuggestions
                    toolCallId={id}
                    className="flex-1 min-w-0 overflow-x-auto"
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
