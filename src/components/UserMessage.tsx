import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AdkPart, ChatMessage } from '@/lib/adk'
import { stripUploadPrefix } from '@/lib/adk'

interface UserMessageProps {
  message: ChatMessage
}

/** A non-image attachment shown as a labelled file chip. */
function FileChip({
  name,
  mimeType,
}: {
  name: string
  mimeType?: string | null
}) {
  return (
    <span
      title={name}
      className="inline-flex items-center gap-6 max-w-full rounded-10 bg-base border border-subtle px-8 py-4 text-caption text-primary"
    >
      <span className="material-symbols-outlined text-body-m text-secondary">
        {mimeType?.startsWith('application/pdf')
          ? 'picture_as_pdf'
          : 'description'}
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}

/** Renders a single attachment part (inline base64 data or a gs:// file reference). */
function AttachmentPart({ part }: { part: AdkPart }) {
  const inline = part.inlineData
  if (inline?.data) {
    const name = inline.displayName
      ? stripUploadPrefix(inline.displayName)
      : '附件'
    if (inline.mimeType?.startsWith('image/')) {
      return (
        <img
          src={`data:${inline.mimeType};base64,${inline.data}`}
          alt={name}
          className="max-w-full max-h-256 rounded-10 border border-subtle"
        />
      )
    }
    return <FileChip name={name} mimeType={inline.mimeType} />
  }

  // History reload: SaveFilesAsArtifactsPlugin replaced inline data with a
  // gs:// fileData reference that can't be previewed in the browser.
  const file = part.fileData
  if (file?.fileUri) {
    return (
      <FileChip
        name={
          file.displayName
            ? stripUploadPrefix(file.displayName)
            : (file.fileUri.split('/').pop() ?? '附件')
        }
        mimeType={file.mimeType}
      />
    )
  }
  return null
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex flex-col items-end">
      <div className="bg-raised p-16 rounded-10 rounded-tr-none max-w-[85%] md:max-w-[70%] text-primary border border-subtle shadow-btn flex flex-col gap-8">
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
          if (part.inlineData || part.fileData) {
            return <AttachmentPart key={i} part={part} />
          }
          return null
        })}
      </div>
      <span className="text-caption text-secondary mt-4 mr-4">使用者輸入</span>
    </div>
  )
}
