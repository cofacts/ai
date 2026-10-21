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
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pasteCounter = useRef(0)

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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles: Array<File> = []
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            pasteCounter.current += 1
            const ext = file.type.split('/')[1] || 'png'
            imageFiles.push(
              new File([file], `Pasted image ${pasteCounter.current}.${ext}`, {
                type: file.type,
              }),
            )
          }
        }
      }
      if (imageFiles.length > 0) {
        setFiles((prev) => [...prev, ...imageFiles])
        e.preventDefault()
      }
    },
    [],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || isStreaming) return
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
    },
    [disabled, isStreaming],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget
    if (
      !(related instanceof Node) ||
      !(e.currentTarget as Element).contains(related)
    ) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      if (disabled || isStreaming) return
      const dropped = Array.from(e.dataTransfer.files)
      if (dropped.length > 0) setFiles((prev) => [...prev, ...dropped])
    },
    [disabled, isStreaming],
  )

  useBlocker({
    shouldBlockFn: () => false,
    enableBeforeUnload: () => isStreaming || !!value.trim() || files.length > 0,
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
    <div className="px-12 md:px-16 pb-12 md:pb-16 pt-8 bg-base shrink-0 z-10">
      <div
        className={`relative rounded-10 shadow-btn border bg-base focus-within:border-accent transition-all ${isDragging && !disabled && !isStreaming ? 'border-accent' : 'border-subtle'}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && !disabled && !isStreaming && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-10 bg-base pointer-events-none">
            <span className="material-symbols-outlined text-heading-l text-primary">
              upload_file
            </span>
            <span className="text-body-s text-primary">放開以附加檔案</span>
          </div>
        )}
        {/* Row 1: text input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onPaste={handlePaste}
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
          className="w-full bg-transparent border-none p-12 min-h-[50px] max-h-128 resize-none text-body-s rounded-10"
          placeholder={placeholder}
        />

        {/* Row 2: upload button · attached-file pills · send button */}
        <div className="flex items-center gap-8 px-8 pb-8">
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
            className="shrink-0 p-6 text-tertiary rounded-10 hover:bg-raised transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-heading-s">
              attach_file
            </span>
          </button>

          <div className="flex flex-1 flex-wrap items-center gap-6 min-w-0">
            {files.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                title={file.name}
                className="inline-flex items-center gap-4 max-w-[12rem] rounded-full bg-raised border border-subtle pl-8 pr-4 py-2 text-caption text-primary"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`移除 ${file.name}`}
                  className="shrink-0 flex items-center justify-center rounded-full hover:bg-selected transition-colors"
                >
                  <span className="material-symbols-outlined text-body-s">
                    close
                  </span>
                </button>
              </span>
            ))}
          </div>

          <button
            onClick={isStreaming ? onStop : handleSubmit}
            disabled={(!isStreaming && !canSend) || disabled}
            className="shrink-0 p-6 bg-accent text-on-accent rounded-10 hover:bg-accent-subtle transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-body-s">
              {isStreaming ? 'stop' : 'send'}
            </span>
          </button>
        </div>
      </div>
      <div className="text-center mt-8">
        <span className="text-[10px] text-tertiary">
          AI 可能會犯錯，請務必查核事實。
        </span>
      </div>
    </div>
  )
}
