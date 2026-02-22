import { useEffect, useRef } from 'react'
import { UserMessage } from './UserMessage'
import { AgentMessage } from './AgentMessage'
import { ChatInput } from './ChatInput'
import type { ChatMessage } from '@/lib/adk'

interface ChatAreaProps {
  messages: Array<ChatMessage>
  isStreaming: boolean
  onSendMessage: (text: string) => void
}

export function ChatArea({
  messages,
  isStreaming,
  onSendMessage,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <>
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 md:space-y-8 chat-container pb-0"
      >
        {/* Date separator */}
        {messages.length > 0 && (
          <div className="flex justify-center">
            <span className="text-xs text-text-muted bg-gray-100 px-3 py-1 rounded-full">
              {new Date().toLocaleDateString('zh-TW', {
                month: 'long',
                day: 'numeric',
              })}{' '}
              {new Date().toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AgentMessage key={msg.id} message={msg} />
          ),
        )}

        {/* Extra space at the bottom */}
        <div className="h-4" />
      </div>

      {/* Input area */}
      <ChatInput onSend={onSendMessage} disabled={isStreaming} />
    </>
  )
}
