import { useCallback, useEffect, useRef, useState } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [value])

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return
    onSend(value.trim())
    setValue('')
  }, [value, disabled, onSend])

  return (
    <div className="px-3 md:px-4 pb-3 md:pb-4 pt-2 bg-white shrink-0 z-10">
      <div className="relative rounded-xl shadow-sm border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          disabled={disabled}
          className="w-full bg-transparent border-none focus:ring-0 p-3 pr-12 min-h-[50px] max-h-32 resize-none text-sm rounded-xl"
          placeholder="詢問後續問題或要求修改..."
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="absolute right-2 bottom-2 p-1.5 bg-primary text-black rounded-lg hover:bg-primary-hover transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-sm">send</span>
        </button>
      </div>
      <div className="text-center mt-2">
        <span className="text-[10px] text-gray-400">
          AI 可能會犯錯，請務必查核事實。
        </span>
      </div>
    </div>
  )
}
