import { useState } from 'react'
import type { ChatMessage } from '@/lib/adk'

interface AgentMessageProps {
  message: ChatMessage
}

export function AgentMessage({ message }: AgentMessageProps) {
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null)

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
        {/* Render text with line breaks */}
        {message.text.split('\n\n').map((paragraph, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {paragraph}
          </p>
        ))}

        {/* Tool calls */}
        {message.toolCalls?.map((tool, i) => (
          <div key={i} className="flex items-center gap-2 pl-1">
            <span className="material-symbols-outlined text-gray-300 text-xs">
              subdirectory_arrow_right
            </span>
            <div className="tool-badge">
              <span className="material-symbols-outlined text-[14px] text-gray-500">
                {tool.name.toLowerCase().includes('search')
                  ? 'search'
                  : tool.name.toLowerCase().includes('verify') ||
                      tool.name.toLowerCase().includes('check')
                    ? 'shield'
                    : tool.name.toLowerCase().includes('cofacts')
                      ? 'fact_check'
                      : 'build'}
              </span>
              <span>{tool.name}</span>
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {message.isStreaming && (
          <p className="flex items-center gap-2 text-gray-500">
            正在思考中
            <span className="typing-indicator ml-1">
              <span />
              <span />
              <span />
            </span>
          </p>
        )}
      </div>

      {/* Feedback buttons (only show when not streaming) */}
      {!message.isStreaming && message.text && (
        <div className="flex items-center gap-3 pt-2 mt-4 border-t border-gray-100">
          <button
            onClick={() =>
              setFeedbackGiven(feedbackGiven === 'up' ? null : 'up')
            }
            className={`p-1 rounded hover:bg-gray-100 transition-colors ${
              feedbackGiven === 'up'
                ? 'text-primary'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              thumb_up
            </span>
          </button>
          <button
            onClick={() =>
              setFeedbackGiven(feedbackGiven === 'down' ? null : 'down')
            }
            className={`p-1 rounded hover:bg-gray-100 transition-colors ${
              feedbackGiven === 'down'
                ? 'text-destructive'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              thumb_down
            </span>
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(message.text)}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded hover:bg-gray-100 ml-auto"
          >
            <span className="material-symbols-outlined text-[18px]">
              content_copy
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
