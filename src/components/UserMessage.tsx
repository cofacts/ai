import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '@/lib/adk'

interface UserMessageProps {
  message: ChatMessage
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex flex-col items-end">
      <div className="bg-bubble-user p-4 rounded-2xl rounded-tr-none max-w-[85%] md:max-w-[70%] text-text-main border border-gray-100 shadow-sm">
        {message.parts?.map((part, i) => {
          if (part.text) {
            return (
              <div key={i} className="prose prose-sm max-w-none prose-p:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {part.text}
                </ReactMarkdown>
              </div>
            )
          }
          return null
        })}
      </div>
      <span className="text-xs text-text-muted mt-1 mr-1">使用者輸入</span>
    </div>
  )
}
