import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { AllTools } from '@/lib/adk'
import type { DraftFields, ReplyCategory } from '@/lib/factCheckDraft'
import type { MaterialSymbol } from '@/components/icons/material-symbols'
import {
  draftFieldsEqual,
  draftFieldsFromArgs,
  draftSubmitProblem,
} from '@/lib/factCheckDraft'
import { useDraftEdit, useSubmittedReply } from '@/hooks/useDraftEdit'
import { submitFactCheckReply } from '@/server/replies.functions'
import { isAuthExpiredError } from '@/lib/authExpired'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/** Why a draft is read-only; null when the user may edit and submit it. */
export type DraftLockReason =
  | 'streaming' // the AI is answering and may propose a newer draft
  | 'sent' // the user's edits were sent to the AI with a chat message
  | 'superseded' // a newer draft exists
  | 'rejected' // the proposal failed the tool's own validation
  | null

export interface DraftPanelContext {
  sessionId: string
  lockReason: DraftLockReason
  /** The Cofacts article this chat is about; submitting needs it. */
  articleId: string | null
  /** Opens the latest draft, offered from a locked one. */
  onOpenLatestDraft?: () => void
}

const CATEGORIES: Array<{
  key: ReplyCategory
  label: string
  icon: MaterialSymbol
  colorClass: string
  activeClass: string
}> = [
  {
    key: 'NOT_ARTICLE',
    label: '不在查證範圍',
    icon: 'warning',
    colorClass: 'text-status-outofscope',
    activeClass:
      'bg-surface-accent-subtle border-border-accent text-text-on-accent',
  },
  {
    key: 'RUMOR',
    label: '含有不實訊息',
    icon: 'cancel',
    colorClass: 'text-status-incorrect',
    activeClass:
      'bg-surface-raised border-border-control text-status-incorrect',
  },
  {
    key: 'NOT_RUMOR',
    label: '含有正確訊息',
    icon: 'check_circle',
    colorClass: 'text-status-correct',
    activeClass: 'bg-surface-raised border-border-subtle text-status-correct',
  },
  {
    key: 'OPINIONATED',
    label: '含有個人意見',
    icon: 'comment',
    colorClass: 'text-status-opinion',
    activeClass: 'bg-surface-raised border-border-subtle text-text-link',
  },
]

const LOCK_MESSAGES: Record<Exclude<DraftLockReason, null>, string> = {
  streaming: 'AI 正在回覆，回覆完成後才能編輯這份草稿。',
  sent: '你的修改已經和訊息一起交給 AI 參考，這份草稿已鎖定。請在 AI 產出的最新草稿上繼續編輯。',
  superseded: '這是較早的草稿。只有最新的草稿可以編輯和送出。',
  rejected: 'AI 的這次提案沒有通過來源檢查，不能送出。請看最新的草稿。',
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      className="ml-auto text-text-tertiary hover:text-text-secondary disabled:opacity-0 transition-colors"
      aria-label="複製"
    >
      <MaterialIcon name={copied ? 'check' : 'content_copy'} size={24} />
    </button>
  )
}

function ClassificationPicker({
  value,
  editable,
  onChange,
}: {
  value: ReplyCategory | null
  editable: boolean
  onChange: (value: ReplyCategory) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="訊息分類"
      aria-readonly={!editable || undefined}
      className="flex flex-row gap-spacing-4 p-spacing-4 bg-surface-raised rounded-radius-10 w-full overflow-x-auto [scrollbar-width:none]"
    >
      {CATEGORIES.map((cat) => {
        const isActive = value === cat.key
        return (
          <button
            key={cat.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={!editable}
            onClick={() => onChange(cat.key)}
            className={cn(
              'flex-1 min-w-[80px] whitespace-nowrap py-spacing-8 text-[10px] font-bold text-center rounded-radius-5 border border-transparent',
              'flex flex-col items-center justify-center gap-spacing-2',
              editable && !isActive && 'hover:bg-surface-selected',
              // cn() drops the base bg / border colors that activeClass replaces.
              isActive
                ? [
                    'bg-surface-base shadow-btn-shadow border-border-subtle',
                    cat.activeClass,
                  ]
                : 'text-text-tertiary',
            )}
          >
            <MaterialIcon
              name={cat.icon}
              size={24}
              className={isActive ? '' : `${cat.colorClass} opacity-40`}
            />
            <span>{cat.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The fact-check reply draft in the right drawer. The latest draft is editable and can be
 * submitted to Cofacts under the user's own account; every other draft is read-only and says
 * why (see `factCheckDraft.ts` for the locking rules).
 */
export function FactCheckDraftPanel({
  toolCallId,
  args,
  context,
}: {
  toolCallId: string
  args: AllTools['draft_factcheck_response']['args']
  context: DraftPanelContext
}) {
  const { sessionId, articleId, onOpenLatestDraft } = context
  const original = draftFieldsFromArgs(args)
  const [edit, setEdit] = useDraftEdit(sessionId, toolCallId)
  const [submittedReplyId, setSubmitted] = useSubmittedReply(
    sessionId,
    toolCallId,
  )
  const lockReason = context.lockReason
  const editable = lockReason === null && !submittedReplyId
  // A locked draft shows what the AI proposed; the user's sent edits are in the chat message.
  const fields: DraftFields = editable && edit ? edit : original
  const isEdited = editable && !!edit && !draftFieldsEqual(edit, original)

  const update = (patch: Partial<DraftFields>) => {
    const next = { ...fields, ...patch }
    setEdit(draftFieldsEqual(next, original) ? null : next)
  }

  const [confirming, setConfirming] = useState(false)
  const submit = useMutation({
    mutationFn: () => {
      if (!articleId || !fields.classification) throw new Error('無法送出')
      return submitFactCheckReply({
        data: {
          articleId,
          classification: fields.classification,
          text: fields.text,
          references: fields.references,
        },
      })
    },
    onSuccess: ({ replyId }) => {
      setSubmitted(replyId)
      setEdit(null)
      setConfirming(false)
    },
  })
  const submitError =
    submit.error && !isAuthExpiredError(submit.error)
      ? submit.error instanceof Error
        ? submit.error.message
        : '送出失敗'
      : null

  const problem = !articleId
    ? '這段對話沒有對應的 Cofacts 訊息，無法直接送出。請從 Cofacts 的訊息頁開始查核。'
    : draftSubmitProblem(fields)

  const textId = useId()
  const referencesId = useId()

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-raised">
      <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20">
        {submittedReplyId ? (
          <div
            role="status"
            className="flex items-start gap-spacing-8 rounded-radius-10 border border-border-subtle bg-surface-base p-spacing-12 text-type-body-s text-text-primary"
          >
            <MaterialIcon
              name="check_circle"
              size={24}
              className="text-status-correct shrink-0"
            />
            <div className="space-y-spacing-4">
              <p className="font-bold">已用你的帳號送出到 Cofacts</p>
              {articleId && (
                <a
                  href={`https://cofacts.tw/article/${articleId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-spacing-4 text-text-link underline"
                >
                  在 Cofacts 查看
                  <MaterialIcon name="open_in_new" size={24} />
                </a>
              )}
            </div>
          </div>
        ) : (
          lockReason && (
            <div className="flex items-start gap-spacing-8 rounded-radius-10 border border-border-subtle bg-surface-base p-spacing-12 text-type-body-s text-text-secondary">
              <MaterialIcon name="lock" size={24} className="shrink-0" />
              <div className="space-y-spacing-8">
                <p>{LOCK_MESSAGES[lockReason]}</p>
                {lockReason !== 'streaming' && onOpenLatestDraft && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenLatestDraft}
                  >
                    開啟最新草稿
                  </Button>
                )}
              </div>
            </div>
          )
        )}

        <ClassificationPicker
          value={fields.classification}
          editable={editable}
          onChange={(classification) => update({ classification })}
        />

        {/* Response text */}
        <div className="space-y-spacing-8">
          <div className="flex items-center gap-spacing-8">
            <label
              htmlFor={textId}
              className="text-type-caption font-bold text-text-tertiary uppercase"
            >
              回應內容
            </label>
            {isEdited && (
              <span className="text-type-caption text-text-link">已修改</span>
            )}
            <CopyButton value={fields.text} />
          </div>
          {editable ? (
            <Textarea
              id={textId}
              value={fields.text}
              onChange={(e) => update({ text: e.target.value })}
              className="w-full min-h-[11rem] bg-surface-base"
            />
          ) : (
            <div
              id={textId}
              className="w-full min-h-[11rem] p-spacing-12 text-type-body-s text-text-primary bg-surface-base border border-border-subtle rounded-radius-10 whitespace-pre-wrap"
            >
              {fields.text || (
                <span className="text-text-disabled">（尚未產生）</span>
              )}
            </div>
          )}
        </div>

        {/* References */}
        <div className="space-y-spacing-8">
          <div className="flex items-center gap-spacing-4">
            <MaterialIcon
              name="link"
              size={24}
              className="text-text-tertiary"
            />
            <label
              htmlFor={referencesId}
              className="text-type-caption font-bold text-text-tertiary uppercase"
            >
              佐證資料
            </label>
            <CopyButton value={fields.references} />
          </div>
          {editable ? (
            <Textarea
              id={referencesId}
              value={fields.references}
              onChange={(e) => update({ references: e.target.value })}
              className="w-full min-h-[8rem] font-mono bg-surface-base text-text-secondary"
            />
          ) : (
            <div
              id={referencesId}
              className="w-full min-h-[8rem] p-spacing-12 text-type-body-s font-mono text-text-secondary bg-surface-base border border-border-subtle rounded-radius-10 whitespace-pre-wrap break-all"
            >
              {fields.references || (
                <span className="text-text-disabled">（尚未產生）</span>
              )}
            </div>
          )}
        </div>

        {isEdited && (
          <div className="flex flex-wrap items-center gap-spacing-8 text-type-caption text-text-tertiary">
            <span>
              修改會保留在這裡；如果繼續和 AI 對話，修改會一起交給 AI 參考。
            </span>
            <Button
              variant="outline"
              size="sm"
              iconStart="undo"
              onClick={() => setEdit(null)}
            >
              還原成 AI 的版本
            </Button>
          </div>
        )}
      </div>

      {/* Submit — the only place a reply is sent from */}
      {editable && (
        <div className="shrink-0 border-t border-border-subtle bg-surface-base p-spacing-16 space-y-spacing-8">
          {problem && (
            <p className="text-type-caption text-text-tertiary">{problem}</p>
          )}
          {submitError && (
            <p role="alert" className="text-type-caption text-status-incorrect">
              送出失敗：{submitError}
            </p>
          )}
          {confirming ? (
            <div className="space-y-spacing-8">
              <p className="text-type-body-s text-text-primary">
                確定要用你的 Cofacts 帳號公開送出這則查核回應嗎？
              </p>
              <div className="flex gap-spacing-8">
                <Button
                  className="flex-1"
                  iconStart="send"
                  disabled={submit.isPending}
                  aria-busy={submit.isPending || undefined}
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending ? '送出中…' : '確定送出'}
                </Button>
                <Button
                  variant="outline"
                  disabled={submit.isPending}
                  onClick={() => setConfirming(false)}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              iconStart="send"
              disabled={!!problem}
              onClick={() => setConfirming(true)}
            >
              送出查核回應
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
