import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import type { ChatMessage } from '@/lib/adk'
import { cn } from '@/lib/utils'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

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
        <div className="flex items-center gap-spacing-8 mb-spacing-8 md:mb-spacing-12">
          <div className="w-spacing-24 h-spacing-24 rounded-full bg-surface-accent-subtle flex items-center justify-center">
            <MaterialIcon
              name="smart_toy"
              size={24}
              className="text-text-on-accent"
            />
          </div>
          <span className="text-type-body-s font-bold text-text-primary">
            {message.author === 'investigator'
              ? 'AI Investigator'
              : message.author === 'verifier'
                ? 'AI Verifier'
                : 'Cofacts AI Agent'}
          </span>
        </div>
      )}

      {/* Message content */}
      <div className="w-full text-text-primary text-type-body-s max-w-none space-y-spacing-8">
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
              <div
                key={i}
                className="flex items-center gap-spacing-8 pl-spacing-4"
              >
                <MaterialIcon
                  name="subdirectory_arrow_right"
                  size={24}
                  className="text-text-disabled"
                />
                <button
                  className={cn(
                    'inline-flex shrink-0 cursor-pointer items-center gap-[6px] rounded-full border border-border-subtle bg-surface-raised px-[10px] py-spacing-2 my-spacing-4 font-mono text-type-caption text-text-secondary transition-all hover:bg-surface-selected hover:text-text-primary',
                    isFocused
                      ? 'bg-surface-accent-subtle text-text-on-accent hover:bg-surface-accent-subtle hover:text-text-on-accent'
                      : 'hover:bg-surface-selected',
                  )}
                  onClick={() => onToolBadgeClick?.(id ?? '')}
                >
                  <MaterialIcon
                    name={
                      lowerName.includes('search')
                        ? 'search'
                        : lowerName.includes('verify') ||
                            lowerName.includes('check')
                          ? 'shield'
                          : lowerName.includes('cofacts')
                            ? 'fact_check'
                            : 'build'
                    }
                    size={24}
                    className="text-text-tertiary"
                  />
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
