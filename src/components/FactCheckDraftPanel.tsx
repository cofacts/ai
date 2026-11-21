import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { AllTools } from '@/lib/adk'
import type {
  DiffSegment,
  DraftFields,
  LookedUpArticle,
  ReplyCategory,
} from '@/lib/factCheckDraft'
import type { MaterialSymbol } from '@/components/icons/material-symbols'
import {
  REPLY_CATEGORY_LABELS,
  blockDiff,
  draftFieldsEqual,
  draftFieldsFromArgs,
  draftSubmitProblem,
  draftTargetProblem,
} from '@/lib/factCheckDraft'
import { useDraftEdit, useSubmittedReply } from '@/hooks/useDraftEdit'
import { submitFactCheckReply } from '@/server/replies.functions'
import { isAuthExpiredError } from '@/lib/authExpired'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SubmitReplyFooter } from '@/components/SubmitReplyFooter'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { cn } from '@/lib/utils'

/** Why a draft is read-only; null when the user may edit and submit it. */
export type DraftLockReason =
  | 'streaming' // the AI is answering and may propose a newer draft
  | 'superseded' // a newer draft exists
  | 'rejected' // the proposal failed the tool's own validation
  | null

export interface DraftPanelContext {
  sessionId: string
  lockReason: DraftLockReason
  /** The user's edits last sent to the AI for this draft; the draft shows them over the AI's. */
  sentEdit: DraftFields | null
  /** The Cofacts article(s) this draft replies to (`draftTargetArticleIds`). */
  targetArticleIds: Array<string>
  /** Every article the chat looked up, for showing the targets' text. */
  articles: Array<LookedUpArticle>
  /** The user's own reply ids per target article, for the 「再次送出」 warning. */
  myReplies: Record<string, Array<string>>
  /** Called after a reply is submitted. */
  onSubmitted?: () => void
  /** Opens the latest draft, offered from a locked one. */
  onOpenLatestDraft?: () => void
  /** The logged-in user's name, shown on the submit button. */
  userName: string | null
  /** This draft is the AI's revision of the user's edits to the previous one. */
  revisedFromUserEdit?: boolean
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
    label: REPLY_CATEGORY_LABELS.NOT_ARTICLE,
    icon: 'warning',
    colorClass: 'text-status-outofscope',
    activeClass:
      'bg-surface-accent-subtle border-border-accent text-text-on-accent',
  },
  {
    key: 'RUMOR',
    label: REPLY_CATEGORY_LABELS.RUMOR,
    icon: 'cancel',
    colorClass: 'text-status-incorrect',
    activeClass:
      'bg-surface-raised border-border-control text-status-incorrect',
  },
  {
    key: 'NOT_RUMOR',
    label: REPLY_CATEGORY_LABELS.NOT_RUMOR,
    icon: 'check_circle',
    colorClass: 'text-status-correct',
    activeClass: 'bg-surface-raised border-border-subtle text-status-correct',
  },
  {
    key: 'OPINIONATED',
    label: REPLY_CATEGORY_LABELS.OPINIONATED,
    icon: 'comment',
    colorClass: 'text-status-opinion',
    activeClass: 'bg-surface-raised border-border-subtle text-text-link',
  },
]

const LOCK_MESSAGES: Record<Exclude<DraftLockReason, null>, string> = {
  streaming: 'AI 正在回覆，回覆完成後才能編輯這份草稿。',
  superseded: '這是較早的草稿，只有最新的草稿可以編輯和送出。',
  rejected: 'AI 的這次提案沒有通過來源檢查，不能送出。請看最新的草稿。',
}

/** The streaming message when the AI is working from edits the user sent with this draft. */
const SENT_EDIT_STREAMING_MESSAGE =
  'AI 正在依你的修改更新草稿，完成前不能編輯。'

/**
 * A locked draft keeps the field's outline but not its white input fill, so it reads as
 * something you can't type in. Shared by the plain and the marked versions.
 */
const READ_ONLY_TEXT =
  'w-full p-spacing-12 text-type-body-s whitespace-pre-wrap border border-border-subtle rounded-radius-10'

/**
 * A locked draft's text with the user's sent edits marked against the AI's version: what they
 * added or rewrote gets a quiet grey highlight and a blue underline, inline so it reads as part of
 * its paragraph; the AI's text they removed is struck through. The legend is in the lock notice.
 */
function MarkedText({
  id,
  segments,
  mono = false,
}: {
  id: string
  segments: Array<DiffSegment>
  mono?: boolean
}) {
  return (
    <div
      id={id}
      className={cn(
        READ_ONLY_TEXT,
        'space-y-spacing-12',
        mono ? 'font-mono break-all text-text-secondary' : 'text-text-primary',
      )}
    >
      {segments.map((seg, i) =>
        seg.kind === 'same' ? (
          <p key={i}>{seg.text}</p>
        ) : seg.kind === 'added' ? (
          <p key={i}>
            <ins className="bg-surface-selected text-text-primary underline decoration-text-link decoration-2 underline-offset-4 rounded-radius-5 px-spacing-2 [box-decoration-break:clone]">
              <span className="sr-only">你修改的內容：</span>
              {seg.text}
            </ins>
          </p>
        ) : (
          <del key={i} className="block text-text-tertiary line-through">
            <span className="sr-only">你刪除的內容：</span>
            {seg.text}
          </del>
        ),
      )}
    </div>
  )
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

/** The start of a looked-up article's text, or its id when the chat never looked it up. */
function articleSnippet(id: string, articles: Array<LookedUpArticle>) {
  const text = articles.find((a) => a.id === id)?.text.trim()
  if (!text) return id
  const chars = Array.from(text.replace(/\s+/g, ' '))
  return chars.length > 20 ? `${chars.slice(0, 20).join('')}…` : text
}

/** Which Cofacts message(s) the reply answers, shown when the chat involves more than one. */
function TargetArticles({
  ids,
  articles,
}: {
  ids: Array<string>
  articles: Array<LookedUpArticle>
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-spacing-8">
      <h3
        id={headingId}
        className="text-type-caption font-bold text-text-tertiary"
      >
        這則回應要回覆的訊息
      </h3>
      {ids.length === 0 ? (
        <p className="text-type-body-s text-text-secondary">（AI 沒有指定）</p>
      ) : (
        <ul className="space-y-spacing-4">
          {ids.map((id) => (
            <li key={id}>
              <a
                href={`https://cofacts.tw/article/${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-spacing-4 rounded-radius-10 border border-border-subtle bg-surface-base p-spacing-8 text-type-body-s text-text-primary hover:bg-surface-selected"
              >
                <span className="min-w-0 flex-1 line-clamp-2">
                  {articles.find((a) => a.id === id)?.text || id}
                </span>
                <MaterialIcon
                  name="open_in_new"
                  size={24}
                  className="shrink-0 text-text-tertiary"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const {
    sessionId,
    sentEdit,
    targetArticleIds,
    articles,
    myReplies,
    onSubmitted,
    onOpenLatestDraft,
    userName,
    revisedFromUserEdit = false,
  } = context
  const original = draftFieldsFromArgs(args)
  // What the draft holds before any unsent edits: the version last sent to the AI, if any.
  const base = sentEdit ?? original
  const [edit, setEdit] = useDraftEdit(sessionId, toolCallId)
  const [submitted, setSubmitted] = useSubmittedReply(sessionId, toolCallId)
  const lockReason = context.lockReason
  const editable = lockReason === null && !submitted
  // The latest draft shows the user's edits (also while the AI answers and after submitting);
  // an older one shows what was last sent to the AI.
  const showsEdit =
    !!submitted || lockReason === null || lockReason === 'streaming'
  const fields: DraftFields = showsEdit && edit ? edit : base
  const isEdited = !draftFieldsEqual(fields, original)
  // A locked draft shows the user's sent version with their changes marked against the AI's.
  const marked =
    !editable && !submitted && isEdited
      ? {
          classification:
            fields.classification !== original.classification
              ? fields.classification
              : null,
          text: blockDiff(original.text, fields.text, 'paragraph'),
          references: blockDiff(original.references, fields.references, 'line'),
        }
      : null
  const textMarked = !!marked?.text.some((seg) => seg.kind !== 'same')
  const referencesMarked = !!marked?.references.some(
    (seg) => seg.kind !== 'same',
  )

  const update = (patch: Partial<DraftFields>) => {
    const next = { ...fields, ...patch }
    setEdit(draftFieldsEqual(next, base) ? null : next)
  }
  const restoreAiVersion = () =>
    setEdit(draftFieldsEqual(original, base) ? null : original)

  // Not reset when the user edits after checking; see SubmitReplyFooter.
  const [reviewed, setReviewed] = useState(false)
  const submit = useMutation({
    mutationFn: () => {
      if (targetArticleIds.length === 0 || !fields.classification)
        throw new Error('無法送出')
      return submitFactCheckReply({
        data: {
          articleIds: targetArticleIds,
          classification: fields.classification,
          text: fields.text,
          references: fields.references,
        },
      })
    },
    onSuccess: ({ replyId, unlinkedArticleIds }) => {
      // Keep the edit: it is what was submitted, and the panel keeps showing it.
      if (!edit) setEdit(fields)
      setSubmitted({
        replyId,
        articleIds: targetArticleIds,
        unlinkedArticleIds,
      })
      onSubmitted?.()
    },
  })
  const submitError =
    submit.error && !isAuthExpiredError(submit.error)
      ? submit.error instanceof Error
        ? submit.error.message
        : '送出失敗'
      : null
  // A submitted draft keeps the targets it was sent to, whatever the chat looks up later.
  const shownTargetIds = submitted?.articleIds.length
    ? submitted.articleIds
    : targetArticleIds
  const unlinkedArticleIds = submitted?.unlinkedArticleIds ?? []

  const problem =
    draftTargetProblem(targetArticleIds, articles) ?? draftSubmitProblem(fields)
  // One reply linked to several targets is listed once.
  const existingReplyIds = [
    ...new Set(targetArticleIds.flatMap((id) => myReplies[id] ?? [])),
  ]
  // Say which message the reply goes to whenever that isn't obvious: the chat involves more
  // than one, or the target is one the chat never opened.
  const showTargets =
    articles.length > 1 ||
    shownTargetIds.length > 1 ||
    shownTargetIds.some((id) => !articles.some((a) => a.id === id))

  const textId = useId()
  const referencesId = useId()

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-raised">
      <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20">
        {submitted ? (
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
              {shownTargetIds.map((articleId) => (
                <a
                  key={articleId}
                  href={`https://cofacts.tw/article/${articleId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-spacing-4 text-text-link underline"
                >
                  在 Cofacts 查看
                  {shownTargetIds.length > 1 &&
                    `（${articleSnippet(articleId, articles)}）`}
                  <MaterialIcon name="open_in_new" size={24} />
                </a>
              ))}
              {unlinkedArticleIds.length > 0 && (
                <p role="alert" className="text-status-incorrect">
                  這則回應沒能連到其中 {unlinkedArticleIds.length} 則訊息，請到
                  Cofacts 手動加上：
                  {unlinkedArticleIds
                    .map((id) => articleSnippet(id, articles))
                    .join('、')}
                </p>
              )}
            </div>
          </div>
        ) : editable && revisedFromUserEdit && !edit ? (
          <div
            role="status"
            className="flex items-start gap-spacing-8 rounded-radius-10 border border-border-subtle bg-surface-base p-spacing-12 text-type-body-s text-text-secondary"
          >
            <MaterialIcon name="edit_document" size={24} className="shrink-0" />
            <p>這是 AI 依你的修改產生的新草稿。</p>
          </div>
        ) : (
          lockReason && (
            <div className="flex items-start gap-spacing-8 rounded-radius-10 border border-border-subtle bg-surface-base p-spacing-12 text-type-body-s text-text-secondary">
              <MaterialIcon name="lock" size={24} className="shrink-0" />
              <div className="space-y-spacing-8">
                <p>
                  {lockReason === 'streaming' && sentEdit
                    ? SENT_EDIT_STREAMING_MESSAGE
                    : LOCK_MESSAGES[lockReason]}
                </p>
                {marked && lockReason !== 'rejected' && (
                  <p>
                    {marked.classification &&
                      `你把分類改為「${REPLY_CATEGORY_LABELS[marked.classification]}」。`}
                    {(textMarked || referencesMarked) &&
                      '藍色底線是你修改過的內容，刪除線是你刪掉的內容。'}
                  </p>
                )}
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

        {showTargets && (
          <TargetArticles ids={shownTargetIds} articles={articles} />
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
          ) : marked && textMarked ? (
            <MarkedText id={textId} segments={marked.text} />
          ) : (
            <div
              id={textId}
              className={cn(READ_ONLY_TEXT, 'text-text-primary')}
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
            {referencesMarked && (
              <span className="text-type-caption text-text-link">已修改</span>
            )}
            <CopyButton value={fields.references} />
          </div>
          {editable ? (
            <Textarea
              id={referencesId}
              value={fields.references}
              onChange={(e) => update({ references: e.target.value })}
              className="w-full min-h-[8rem] font-mono bg-surface-base text-text-secondary"
            />
          ) : marked && referencesMarked ? (
            <MarkedText id={referencesId} segments={marked.references} mono />
          ) : (
            <div
              id={referencesId}
              className={cn(
                READ_ONLY_TEXT,
                'font-mono text-text-secondary break-all',
              )}
            >
              {fields.references || (
                <span className="text-text-disabled">（尚未產生）</span>
              )}
            </div>
          )}
        </div>

        {editable && isEdited && (
          <div className="flex flex-wrap items-center gap-spacing-8 text-type-caption text-text-tertiary">
            <span>
              修改會保留在這裡；如果繼續和 AI 對話，修改會一起交給 AI 參考。
            </span>
            <Button
              variant="outline"
              size="sm"
              iconStart="undo"
              onClick={restoreAiVersion}
            >
              還原成 AI 的版本
            </Button>
          </div>
        )}
      </div>

      {/* Submit — the only place a reply is sent from */}
      {editable && (
        <SubmitReplyFooter
          userName={userName}
          existingReplyIds={existingReplyIds}
          checked={reviewed}
          onCheckedChange={setReviewed}
          problem={problem}
          pending={submit.isPending}
          error={submitError}
          onSubmit={() => {
            submit.reset()
            submit.mutate()
          }}
        />
      )}
    </div>
  )
}
