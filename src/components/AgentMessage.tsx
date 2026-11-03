import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import type { ChatMessage } from '@/lib/adk'
import { cn } from '@/lib/utils'

/**
 * Runtime agent names (`name=` in `adk/cofacts_ai/agent.py`) to what the user
 * sees. Anything unlisted falls back to the generic label, which is what the
 * writer — the agent users spend most of a fact-check with — deliberately uses.
 *
 * Only agents that run inside the persisted session can ever appear here, which
 * today means `receptionist` and `writer` and nothing else. An `AgentTool`
 * sub-agent (investigator, verifier, the proofreaders) runs in a throwaway
 * in-memory session of its own and only its last message comes back, as a tool
 * result — so it never authors an event the frontend sees, and adding one here
 * would be dead code. Their names still appear elsewhere in this file and in
 * RightDrawer as *tool* names, which is a different thing and still live.
 */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  receptionist: 'Cofacts Assistant',
}

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
        <div className="flex items-center gap-2 mb-2 md:mb-3">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-sm text-yellow-700">
              smart_toy
            </span>
          </div>
          <span className="text-sm font-semibold text-gray-900">
            {AGENT_DISPLAY_NAMES[message.author ?? ''] ?? 'Cofacts AI Agent'}
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
            const lowerName = name?.toLowerCase() ?? ''
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
