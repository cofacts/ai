import { useId, useState } from 'react'

import { categoryVoteShares } from '../-lib'
import type { CategoryVotes } from '../-lib'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type CategoryOptionData = CategoryVotes & {
  id: string
  title: string
  description?: string | null
  /** The category is on this message. */
  marked: boolean
  /** The current user marked it, so they may unmark it and may not vote on it. */
  canUnmark: boolean
  ownVote?: 'UPVOTE' | 'DOWNVOTE' | 'NEUTRAL' | null
}

export type Disagreement = {
  id?: string | null
  comment: string
  userName: string | null
}

export type CategoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** undefined while the category list loads. */
  categories: Array<CategoryOptionData> | undefined
  loadFailed?: boolean
  /** The category a write is in flight for; its buttons are disabled meanwhile. */
  busyCategoryId?: string | null
  /** Announced after a write: 感謝你的回饋, or what went wrong. */
  statusMessage?: string | null
  /** The category whose disagreement form is open. */
  disagreeingId?: string | null
  /** Others' reasons for disagreeing with that category; undefined while loading. */
  disagreements?: Array<Disagreement>
  onMark: (categoryId: string) => void
  onUnmark: (categoryId: string) => void
  onAgree: (categoryId: string) => void
  onStartDisagree: (categoryId: string) => void
  onCancelDisagree: () => void
  onDisagree: (categoryId: string, reason: string) => void
}

/**
 * 為這則訊息分類 (rumors-site's AddCategoryDialog + CategoryOption + DownVoteDialog):
 * every category, those on the message first. One marks a category that isn't
 * there, unmarks one they marked, and agrees or disagrees with one someone else
 * marked; a disagreement asks why, showing why others disagreed. The disagreement
 * form opens inside the option instead of in a second dialog.
 */
export function CategoryDialog({
  open,
  onOpenChange,
  categories,
  loadFailed,
  busyCategoryId,
  statusMessage,
  disagreeingId,
  disagreements,
  onMark,
  onUnmark,
  onAgree,
  onStartDisagree,
  onCancelDisagree,
  onDisagree,
}: CategoryDialogProps) {
  const sorted = categories && [
    ...categories.filter((category) => category.marked),
    ...categories.filter((category) => !category.marked),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-spacing-16 overflow-hidden">
        <div className="flex flex-col gap-spacing-8">
          <DialogTitle>為這則訊息分類</DialogTitle>
          <DialogDescription>
            訊息大多由 AI
            依現有資料自動分類，你可以提供自己的看法，讓分類更準確。
          </DialogDescription>
        </div>

        <p role="status" className="text-type-body-s text-text-primary">
          {statusMessage}
        </p>

        <div className="-mx-spacing-24 overflow-y-auto overscroll-contain px-spacing-24">
          {loadFailed ? (
            <p className="text-type-body-m text-text-secondary">
              分類清單載入失敗，請稍後再試。
            </p>
          ) : !sorted ? (
            <p
              className="text-type-body-m text-text-secondary"
              aria-busy="true"
            >
              載入分類中…
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {sorted.map((category) => (
                <CategoryOption
                  key={category.id}
                  category={category}
                  busy={busyCategoryId === category.id}
                  disagreeing={disagreeingId === category.id}
                  disagreements={
                    disagreeingId === category.id ? disagreements : undefined
                  }
                  onMark={() => onMark(category.id)}
                  onUnmark={() => onUnmark(category.id)}
                  onAgree={() => onAgree(category.id)}
                  onStartDisagree={() => onStartDisagree(category.id)}
                  onCancelDisagree={onCancelDisagree}
                  onDisagree={(reason) => onDisagree(category.id, reason)}
                />
              ))}
            </ul>
          )}
        </div>

        <DialogClose
          render={
            <Button variant="outline" className="self-end">
              關閉
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function CategoryOption({
  category,
  busy,
  disagreeing,
  disagreements,
  onMark,
  onUnmark,
  onAgree,
  onStartDisagree,
  onCancelDisagree,
  onDisagree,
}: {
  category: CategoryOptionData
  busy: boolean
  disagreeing: boolean
  disagreements: Array<Disagreement> | undefined
  onMark: () => void
  onUnmark: () => void
  onAgree: () => void
  onStartDisagree: () => void
  onCancelDisagree: () => void
  onDisagree: (reason: string) => void
}) {
  const titleId = useId()
  const shares = categoryVoteShares(category)
  // As on rumors-site, the person who marked a category doesn't vote on it.
  const canVote = category.marked && !category.canUnmark

  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-spacing-8 py-spacing-16"
    >
      <div className="flex flex-wrap items-center gap-spacing-8">
        <h3
          id={titleId}
          className={cn(
            'rounded-full border px-spacing-12 py-spacing-4 text-type-ui-m-bold text-text-primary',
            category.marked
              ? 'border-border-strong bg-surface-selected'
              : 'border-border-subtle',
          )}
        >
          <span aria-hidden="true"># </span>
          {category.title}
        </h3>
        {category.marked && (
          <span className="text-type-ui-s text-text-secondary">已標記</span>
        )}
        {!category.marked && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onMark}>
            標記
          </Button>
        )}
        {category.marked && category.canUnmark && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onUnmark}
          >
            取消標記
          </Button>
        )}
      </div>

      {category.marked && (
        <div className="flex flex-wrap items-center gap-spacing-8">
          <VoteButton
            label="同意"
            icon="thumb_up"
            pressed={category.ownVote === 'UPVOTE'}
            disabled={busy || !canVote}
            onClick={onAgree}
          />
          <VoteButton
            label="不同意"
            icon="thumb_down"
            pressed={category.ownVote === 'DOWNVOTE'}
            disabled={busy || !canVote}
            onClick={onStartDisagree}
          />
          <p className="text-type-body-s text-text-secondary">
            {shares
              ? `${shares.agree}% 同意、${shares.disagree}% 不同意`
              : '還沒有人投票'}
          </p>
        </div>
      )}

      {disagreeing && (
        <DisagreeForm
          categoryTitle={category.title}
          disagreements={disagreements}
          busy={busy}
          onCancel={onCancelDisagree}
          onSubmit={onDisagree}
        />
      )}

      {category.description && (
        <p className="text-type-body-s whitespace-pre-wrap text-text-secondary">
          {category.description}
        </p>
      )}
      <a
        href={`/articles?categoryIds=${encodeURIComponent(category.id)}`}
        className="self-start text-type-ui-s text-text-link underline"
      >
        看「{category.title}」的範例
      </a>
    </li>
  )
}

function VoteButton({
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: {
  label: string
  icon: 'thumb_up' | 'thumb_down'
  pressed: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      iconStart={icon}
      aria-pressed={pressed}
      disabled={disabled}
      // Voting the same way again changes nothing, as on rumors-site.
      onClick={pressed ? undefined : onClick}
      className={cn(pressed && 'border-border-strong bg-surface-selected')}
    >
      {label}
    </Button>
  )
}

function DisagreeForm({
  categoryTitle,
  disagreements,
  busy,
  onCancel,
  onSubmit,
}: {
  categoryTitle: string
  disagreements: Array<Disagreement> | undefined
  busy: boolean
  onCancel: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const fieldId = useId()

  return (
    <form
      className="flex flex-col gap-spacing-12 rounded-radius-5 border border-border-subtle bg-surface-raised p-spacing-16"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(reason)
      }}
    >
      {disagreements === undefined ? (
        <p className="text-type-body-s text-text-secondary" aria-busy="true">
          載入其他人的理由…
        </p>
      ) : disagreements.length > 0 ? (
        <div className="flex flex-col gap-spacing-8">
          <p className="text-type-ui-s-bold text-text-primary">
            其他人不同意的理由
          </p>
          <ul className="flex flex-col gap-spacing-8">
            {disagreements.map((item, index) => (
              <li
                key={item.id ?? index}
                className="text-type-body-s text-text-primary"
              >
                <span className="text-text-secondary">
                  {item.userName || '有人'}：
                </span>
                <span className="whitespace-pre-wrap">{item.comment}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-spacing-4">
        <Label htmlFor={fieldId}>
          為什麼這則訊息不屬於「{categoryTitle}」？
        </Label>
        <Textarea
          id={fieldId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-spacing-8">
        <Button type="button" variant="outline" size="md" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="md" disabled={busy}>
          送出不同意
        </Button>
      </div>
    </form>
  )
}
