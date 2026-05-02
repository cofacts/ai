import { useCallback, useEffect, useRef, useState } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
}

export function ChatInput({
  onSend,
  disabled,
  placeholder = '詢問後續問題或要求修改...',
  value: controlledValue,
  onChange,
}: ChatInputProps) {
  const [localValue, setLocalValue] = useState(controlledValue ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Update local value when controlled value changes (e.g. session switch)
  useEffect(() => {
    if (controlledValue !== undefined) {
      setLocalValue(controlledValue)
    }
  }, [controlledValue])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [localValue])

  const handleSubmit = useCallback(() => {
    if (!localValue.trim() || disabled) return
    onSend(localValue.trim())
    setLocalValue('')
    onChange?.('')
  }, [localValue, disabled, onSend, onChange])

  return (
    <div className="px-3 md:px-4 pb-3 md:pb-4 pt-2 bg-white shrink-0 z-10">
      <div className="relative rounded-xl shadow-sm border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
        <textarea
          ref={textareaRef}
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value)
            onChange?.(e.target.value)
          }}
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
          disabled={disabled}
          className="w-full bg-transparent border-none focus:ring-0 p-3 pr-12 min-h-[50px] max-h-32 resize-none text-sm rounded-xl"
          placeholder={placeholder}
        />
        <button
          onClick={handleSubmit}
          disabled={!localValue.trim() || disabled}
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
