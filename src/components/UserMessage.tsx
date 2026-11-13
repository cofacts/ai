import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AdkPart, ChatMessage } from '@/lib/adk'
import type { DraftFields } from '@/lib/factCheckDraft'
import { stripUploadPrefix } from '@/lib/adk'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { parseEditedDraftPart } from '@/lib/factCheckDraft'

const CATEGORY_LABELS: Record<string, string> = {
  NOT_ARTICLE: '不在查證範圍',
  RUMOR: '含有不實訊息',
  NOT_RUMOR: '含有正確訊息',
  OPINIONATED: '含有個人意見',
}

/** The user's edited draft that was sent along with this message for the AI to revise from. */
function EditedDraftPart({ fields }: { fields: DraftFields }) {
  return (
    <details className="rounded-radius-10 bg-surface-base border border-border-subtle text-type-caption text-text-primary">
      <summary className="flex cursor-pointer items-center gap-[6px] px-spacing-8 py-spacing-4">
        <MaterialIcon
          name="edit_document"
          size={24}
          className="text-text-secondary"
        />
        附上我修改過的查核回應草稿
      </summary>
      <div className="space-y-spacing-8 border-t border-border-subtle p-spacing-8 whitespace-pre-wrap break-all">
        {fields.classification && (
          <p className="font-bold">
            {CATEGORY_LABELS[fields.classification] ?? fields.classification}
          </p>
        )}
        <p>{fields.text}</p>
        {fields.references && (
          <p className="font-mono text-text-secondary">{fields.references}</p>
        )}
      </div>
    </details>
  )
}

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
      className="inline-flex items-center gap-[6px] max-w-full rounded-radius-10 bg-surface-base border border-border-subtle px-spacing-8 py-spacing-4 text-type-caption text-text-primary"
    >
      <MaterialIcon
        name={
          mimeType?.startsWith('application/pdf')
            ? 'picture_as_pdf'
            : 'description'
        }
        size={24}
        className="text-text-secondary"
      />
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
          className="max-w-full max-h-[256px] rounded-radius-10 border border-border-subtle"
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
      <div className="bg-surface-raised p-spacing-16 rounded-radius-10 rounded-tr-none max-w-[85%] md:max-w-[70%] text-text-primary border border-border-subtle shadow-btn-shadow flex flex-col gap-spacing-8">
        {message.parts?.map((part, i) => {
          if (part.text) {
            const editedDraft = parseEditedDraftPart(part.text)
            if (editedDraft) {
              return <EditedDraftPart key={i} fields={editedDraft.fields} />
            }
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
      <span className="text-type-caption text-text-secondary mt-spacing-4 mr-spacing-4">
        使用者輸入
      </span>
    </div>
  )
}
