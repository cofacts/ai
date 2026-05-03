import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'

const drafts = new Map<string, string>()

interface ChatInputProps {
  onSend: (text: string) => void
  onStop?: () => void
  isStreaming?: boolean
  disabled?: boolean
  placeholder?: string
  sessionId?: string
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder = '詢問後續問題或要求修改...',
  sessionId,
}: ChatInputProps) {
  const [value, setValue] = useState(() =>
    sessionId ? (drafts.get(sessionId) ?? '') : '',
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [value])

  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue)
      if (sessionId) {
        if (newValue) drafts.set(sessionId, newValue)
        else drafts.delete(sessionId)
      }
    },
    [sessionId],
  )

  useBlocker({
    shouldBlockFn: () => false,
    enableBeforeUnload: () => isStreaming || !!value.trim(),
  })

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return
    if (sessionId) drafts.delete(sessionId)
    onSend(value.trim())
    setValue('')
  }, [value, disabled, onSend, sessionId])

  return (
    <div className="px-3 md:px-4 pb-3 md:pb-4 pt-2 bg-white shrink-0 z-10">
      <div className="relative rounded-xl shadow-sm border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          disabled={disabled || isStreaming}
          className="w-full bg-transparent border-none focus:ring-0 p-3 pr-12 min-h-[50px] max-h-32 resize-none text-sm rounded-xl"
          placeholder={placeholder}
        />
        <button
          onClick={isStreaming ? onStop : handleSubmit}
          disabled={(!isStreaming && !value.trim()) || disabled}
          className="absolute right-2 bottom-2 p-1.5 bg-primary text-black rounded-lg hover:bg-primary-hover transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-sm">
            {isStreaming ? 'stop' : 'send'}
          </span>
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
