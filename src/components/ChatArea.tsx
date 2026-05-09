import React, { useEffect, useRef } from 'react'
import { UserMessage } from './UserMessage'
import { AgentMessage } from './AgentMessage'
import { FeedbackButtons } from './FeedbackButtons'
import { ChatInput } from './ChatInput'
import { LoginPrompt } from './LoginPrompt'
import type { ChatMessage } from '@/lib/adk'
import { useAuth } from '@/lib/auth'

interface ChatAreaProps {
  messages: Array<ChatMessage>
  isStreaming: boolean
  onSendMessage: (text: string) => void
  onStop?: () => void
  sessionId?: string
}

export function ChatArea({
  messages,
  isStreaming,
  onSendMessage,
  onStop,
  sessionId,
}: ChatAreaProps) {
  const { user } = useAuth()
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
        className="flex-1 overflow-y-auto p-4 md:p-6 chat-container pb-0"
      >
        {messages.map((msg, index) => {
          const prevMsg = messages[index - 1] as ChatMessage | undefined
          const nextMsg = messages[index + 1] as ChatMessage | undefined

          return (
            <React.Fragment key={msg.id}>
              {msg.author === 'user' ? (
                <UserMessage message={msg} />
              ) : (
                <AgentMessage
                  message={msg}
                  showAvatar={msg.author !== prevMsg?.author}
                />
              )}
              {
                /* Show thumbs up/down when all below are true:
                - Message has trace id
                - Message is not streaming
                - Next message has different trace id or doesn't exist
              */
                msg.langfuseTraceId &&
                  !msg.isStreaming &&
                  (!nextMsg?.langfuseTraceId ||
                    msg.langfuseTraceId !== nextMsg.langfuseTraceId) && (
                    <FeedbackButtons traceId={msg.langfuseTraceId} />
                  )
              }
            </React.Fragment>
          )
        })}

        {isStreaming && (
          <p className="flex items-center gap-2 text-gray-500 mt-2">
            正在思考中
            <span className="typing-indicator ml-1">
              <span />
              <span />
              <span />
            </span>
          </p>
        )}

        {/* Extra space at the bottom */}
        <div className="h-4" />
      </div>

      {/* Input area */}
      {user ? (
        <ChatInput
          onSend={onSendMessage}
          onStop={onStop}
          isStreaming={isStreaming}
          key={sessionId} // Reset input when session changes
          sessionId={sessionId}
        />
      ) : (
        <LoginPrompt message="登入後即可繼續與 Cofacts.ai 對話" />
      )}
    </>
  )
}
