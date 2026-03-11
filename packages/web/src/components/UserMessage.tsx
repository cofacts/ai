import type { ChatMessage } from '@/lib/adk'

interface UserMessageProps {
  message: ChatMessage
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex flex-col items-end">
      <div className="bg-bubble-user p-4 rounded-2xl rounded-tr-none max-w-[85%] md:max-w-[70%] text-text-main border border-gray-100 shadow-sm">
        <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
      </div>
      <span className="text-xs text-text-muted mt-1 mr-1">使用者輸入</span>
    </div>
  )
}
