import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/lib/adk'

interface AgentMessageProps {
  message: ChatMessage
}

export function AgentMessage({ message }: AgentMessageProps) {
  return (
    <div className="flex flex-col items-start w-full">
      {/* Agent header */}
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

      {/* Message content */}
      <div className="w-full text-text-main leading-7 text-sm max-w-none space-y-4">
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
            const tool = part.functionCall
            return (
              <div key={i} className="flex items-center gap-2 pl-1">
                <span className="material-symbols-outlined text-gray-300 text-xs">
                  subdirectory_arrow_right
                </span>
                <div className="tool-badge">
                  <span className="material-symbols-outlined text-[14px] text-gray-500">
                    {tool.name?.toLowerCase()?.includes('search')
                      ? 'search'
                      : tool.name?.toLowerCase()?.includes('verify') ||
                        tool.name?.toLowerCase()?.includes('check')
                        ? 'shield'
                        : tool.name?.toLowerCase()?.includes('cofacts')
                          ? 'fact_check'
                          : 'build'}
                  </span>
                  <span>{tool.name}</span>
                </div>
              </div>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
