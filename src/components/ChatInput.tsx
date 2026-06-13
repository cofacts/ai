import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'

// Map of draft messages by sessionId
const drafts = new Map<string, string>()

// Files Gemini can ingest. Attachments are uploaded inline (base64) and the
// backend's SaveFilesAsArtifactsPlugin moves them to the artifact store, so we
// accept the broad set of types Gemini supports rather than just images/PDF.
const ACCEPT = 'image/*,application/pdf,audio/*,video/*,text/plain'

interface ChatInputProps {
  onSend: (text: string, files: Array<File>) => void
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
  sessionId = '', // ChatInput without sessionId will connect to empty sessionId
}: ChatInputProps) {
  const [value, setValue] = useState(() => drafts.get(sessionId) ?? '')
  const [files, setFiles] = useState<Array<File>>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      if (newValue) drafts.set(sessionId, newValue)
      else drafts.delete(sessionId)
    },
    [sessionId],
  )

  const handleFilesPicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Materialize into a plain array synchronously: e.target.files is a live
      // FileList that e.target.value = '' empties, and the setFiles updater runs
      // later (during render), so reading it inside the updater would lose the
      // selection.
      const picked = e.target.files ? Array.from(e.target.files) : []
      // Reset so picking the same file again re-fires onChange.
      e.target.value = ''
      if (picked.length > 0) {
        setFiles((prev) => [...prev, ...picked])
      }
    },
    [],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  useBlocker({
    shouldBlockFn: () => false,
    enableBeforeUnload: () =>
      isStreaming || !!value.trim() || files.length > 0,
  })

  const canSend = !!value.trim() || files.length > 0

  const handleSubmit = useCallback(() => {
    if ((!value.trim() && files.length === 0) || disabled) return
    drafts.delete(sessionId)
    onSend(value.trim(), files)
    setValue('')
    setFiles([])
  }, [value, files, disabled, onSend, sessionId])

  return (
    <div className="px-3 md:px-4 pb-3 md:pb-4 pt-2 bg-white shrink-0 z-10">
      <div className="rounded-xl shadow-sm border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
        {/* Row 1: text input */}
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
          className="w-full bg-transparent border-none focus:ring-0 p-3 min-h-[50px] max-h-32 resize-none text-sm rounded-xl"
          placeholder={placeholder}
        />

        {/* Row 2: upload button · attached-file pills · send button */}
        <div className="flex items-center gap-2 px-2 pb-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={handleFilesPicked}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isStreaming}
            title="附加檔案"
            className="shrink-0 p-1.5 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-xl">
              attach_file
            </span>
          </button>

          <div className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0">
            {files.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                title={file.name}
                className="inline-flex items-center gap-1 max-w-[12rem] rounded-full bg-gray-100 border border-gray-200 pl-2 pr-1 py-0.5 text-xs text-text-main"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`移除 ${file.name}`}
                  className="shrink-0 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm leading-none">
                    close
                  </span>
                </button>
              </span>
            ))}
          </div>

          <button
            onClick={isStreaming ? onStop : handleSubmit}
            disabled={(!isStreaming && !canSend) || disabled}
            className="shrink-0 p-1.5 bg-primary text-black rounded-lg hover:bg-primary-hover transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm">
              {isStreaming ? 'stop' : 'send'}
            </span>
          </button>
        </div>
      </div>
      <div className="text-center mt-2">
        <span className="text-[10px] text-gray-400">
          AI 可能會犯錯，請務必查核事實。
        </span>
      </div>
    </div>
  )
}
