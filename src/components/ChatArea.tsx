import React, { useEffect, useRef } from 'react'
import { UserMessage } from './UserMessage'
import { AgentMessage } from './AgentMessage'
import { FeedbackButtons } from './FeedbackButtons'
import { ChatInput } from './ChatInput'
import styles from './ChatArea.module.css'
import type { ChatMessage } from '@/lib/adk'

interface ChatAreaProps {
  messages: Array<ChatMessage>
  isStreaming: boolean
  onSendMessage: (text: string, files: Array<File>) => void
  onStop?: () => void
  sessionId?: string
  focusedToolCallId?: string | null
  onToolBadgeClick?: (id: string) => void
}

export function ChatArea({
  messages,
  isStreaming,
  onSendMessage,
  onStop,
  sessionId,
  focusedToolCallId,
  onToolBadgeClick,
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
        className="flex-1 overflow-y-auto p-spacing-16 md:p-spacing-24 [scrollbar-gutter:stable] pb-0"
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
                  focusedToolCallId={focusedToolCallId}
                  onToolBadgeClick={onToolBadgeClick}
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
          <p className="flex items-center gap-spacing-8 text-text-tertiary mt-spacing-8">
            正在思考中
            <span className={`${styles.typing} ml-spacing-4`}>
              <span />
              <span />
              <span />
            </span>
          </p>
        )}

        {/* Extra space at the bottom */}
        <div className="h-spacing-16" />
      </div>

      {/* Input area */}
      <ChatInput
        onSend={onSendMessage}
        onStop={onStop}
        isStreaming={isStreaming}
        key={sessionId} // Reset input when session changes
        sessionId={sessionId}
      />
    </>
  )
}
