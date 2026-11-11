import { useState } from 'react'
import type { ReactNode } from 'react'

import type {
  ContributionEntry,
  ContributionKind,
  ContributionTask,
  FeedbackVoteValue,
} from '@/lib/contributions'
import type { ReplyType } from '@/components/icons/StatusIcon'
import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { interleave, taskKey } from '@/lib/contributions'
import { replyTypeText } from '@/components/FactCheckReplyTitle'
import { StatusIcon } from '@/components/icons/StatusIcon'
import { MaterialIcon } from '@/components/icons/MaterialIcon'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Pages not yet migrated to this app (kb doc §2.2); switch to local paths when they land. */
const articleHref = (id: string) => `https://cofacts.tw/article/${id}`
const replyHref = (id: string) => `https://cofacts.tw/reply/${id}`

type Filter = 'all' | ContributionKind | 'task'

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'report', label: '回報' },
  { value: 'reply', label: '查核回應' },
  { value: 'feedback', label: '評價' },
  { value: 'task', label: '可以做的事' },
]

/** `2026-11-09T…` → `2026/11/9`, in Taiwan time (same on server and browser). */
const dateFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

export type VoteHandler = (
  task: Extract<ContributionTask, { kind: 'rate' }>,
  vote: FeedbackVoteValue,
) => Promise<void>

/**
 * 我的貢獻 timeline: what the user did, newest first, with cards for what they could do next in
 * between (one on top, then one every three entries). Contributions only add up; nothing here
 * goes away when the user is inactive.
 */
export function ContributionFeed({
  entries,
  tasks,
  onVote,
}: {
  entries: ReadonlyArray<ContributionEntry>
  tasks: ReadonlyArray<ContributionTask>
  onVote: VoteHandler
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const items =
    filter === 'all'
      ? interleave(entries, tasks)
      : filter === 'task'
        ? tasks.map((task) => ({ type: 'task' as const, task }))
        : entries
            .filter((e) => e.kind === filter)
            .map((entry) => ({ type: 'entry' as const, entry }))

  return (
    <section
      aria-labelledby="contrib-feed"
      className="flex flex-col gap-spacing-12"
    >
      <h2 id="contrib-feed" className="text-type-heading-xs text-text-primary">
        貢獻紀錄
      </h2>
      <div
        role="group"
        aria-label="篩選貢獻紀錄"
        className="-mx-spacing-20 flex gap-spacing-8 overflow-x-auto px-spacing-20 pb-spacing-4 md:mx-0 md:px-0"
      >
        {FILTERS.map(({ value, label }) => (
          <Badge
            key={value}
            pressed={filter === value}
            onPressedChange={() => setFilter(value)}
          >
            {label}
          </Badge>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-radius-10 bg-surface-raised p-spacing-16 text-type-body-m text-text-secondary">
          {filter === 'task'
            ? '目前沒有推薦給你的事，晚點再回來看看。'
            : '這裡還沒有紀錄。回報一則可疑訊息、評價一則查核回應，都會出現在這裡。'}
        </p>
      ) : (
        <ol className="flex flex-col">
          {items.map((item) =>
            item.type === 'task' ? (
              <li key={taskKey(item.task)} className="py-spacing-8">
                <TaskCard task={item.task} onVote={onVote} />
              </li>
            ) : (
              <li
                key={`${item.entry.kind}:${item.entry.id}`}
                className="border-b border-border-subtle last:border-b-0"
              >
                <EntryRow entry={item.entry} />
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  )
}

const ENTRY_LOOK: Record<
  ContributionKind,
  { icon: MaterialSymbol; label: string }
> = {
  report: { icon: 'flag_2', label: '回報可疑訊息' },
  reply: { icon: 'edit_document', label: '撰寫查核回應' },
  feedback: { icon: 'thumb_up', label: '評價查核回應' },
}

function EntryRow({ entry }: { entry: ContributionEntry }) {
  const look = ENTRY_LOOK[entry.kind]
  const icon: MaterialSymbol =
    entry.kind === 'feedback' && entry.vote === 'DOWNVOTE'
      ? 'thumb_down'
      : look.icon
  const href =
    entry.kind === 'reply' ? replyHref(entry.id) : articleHref(entry.articleId)

  return (
    <a
      href={href}
      className="flex gap-spacing-12 rounded-radius-5 py-spacing-12 no-underline hover:bg-surface-raised md:px-spacing-8"
    >
      <span className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-surface-raised text-icon-default">
        <MaterialIcon name={icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-spacing-4">
        <span className="text-type-caption text-text-tertiary">
          {look.label} ·{' '}
          <time dateTime={entry.createdAt}>
            {dateFormat.format(new Date(entry.createdAt))}
          </time>
        </span>
        {entry.kind === 'reply' ? (
          <>
            <ReplyTypeLabel type={entry.replyType} />
            <span className="line-clamp-2 text-type-body-s text-text-primary">
              {entry.replyText}
            </span>
            <Note icon="thumb_up">{entry.upvotes} 人覺得有幫助</Note>
          </>
        ) : (
          <>
            <span className="line-clamp-2 text-type-body-s text-text-primary">
              {entry.articleText}
            </span>
            {entry.kind === 'report' && entry.reason && (
              <span className="line-clamp-2 text-type-body-s text-text-secondary">
                你的理由：{entry.reason}
              </span>
            )}
            {entry.kind === 'report' && (
              <Note icon={entry.replyCount > 0 ? 'check_circle' : 'group'}>
                {entry.replyCount > 0
                  ? `已有 ${entry.replyCount} 則查核回應`
                  : '等待查核中'}
              </Note>
            )}
            {entry.kind === 'feedback' && (
              <Note icon={icon}>
                你覺得這則查核回應
                {entry.vote === 'UPVOTE' ? '有幫助' : '沒有幫助'}
              </Note>
            )}
          </>
        )}
      </span>
    </a>
  )
}

function Note({
  icon,
  children,
}: {
  icon: MaterialSymbol
  children: ReactNode
}) {
  return (
    <span className="flex items-center gap-spacing-4 text-type-ui-xs text-text-secondary">
      <MaterialIcon name={icon} size={16} className="text-icon-muted" />
      {children}
    </span>
  )
}

/** Fact-check result as text + shape + color (R1), in a size that fits a list row. */
function ReplyTypeLabel({ type }: { type: ReplyType }) {
  const color = {
    RUMOR: 'text-status-incorrect',
    NOT_RUMOR: 'text-status-correct',
    OPINIONATED: 'text-status-opinion',
    NOT_ARTICLE: 'text-status-outofscope',
  }[type]
  return (
    <span
      className={cn(
        'flex items-center gap-spacing-4 text-type-ui-s-bold',
        color,
      )}
    >
      <StatusIcon type={type} className="size-spacing-16 md:size-spacing-16" />
      {replyTypeText[type]}
    </span>
  )
}

function Quote({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-spacing-4 rounded-radius-5 bg-surface-base p-spacing-12">
      <span className="text-type-caption text-text-tertiary">{label}</span>
      <span className="line-clamp-3 text-type-body-s text-text-primary">
        {children}
      </span>
    </div>
  )
}

type VoteState = 'idle' | 'pending' | FeedbackVoteValue | 'error'

/** Something to do next, on the yellow card: rate a reply (one tap) or write one. */
function TaskCard({
  task,
  onVote,
}: {
  task: ContributionTask
  onVote: VoteHandler
}) {
  const [state, setState] = useState<VoteState>('idle')

  const vote = async (value: FeedbackVoteValue) => {
    if (task.kind !== 'rate') return
    setState('pending')
    try {
      await onVote(task, value)
      setState(value)
    } catch {
      setState('error')
    }
  }

  const heading =
    task.kind === 'write'
      ? '還沒有人回應的訊息'
      : task.reason === 'reported'
        ? '你回報的訊息有查核回應了'
        : '這則查核回應需要更多評價'
  const why =
    task.kind === 'write'
      ? `${task.replyRequestCount} 人想知道這是真的假的`
      : task.reason === 'reported'
        ? '它對你有幫助嗎？你的評價會讓好的回應排在前面'
        : `目前只有 ${task.feedbackCount} 個評價`

  return (
    <article
      aria-label={heading}
      className="flex flex-col gap-spacing-12 rounded-radius-10 bg-surface-accent-subtle p-spacing-16 text-text-on-accent"
    >
      <header className="flex items-start gap-spacing-8">
        <MaterialIcon
          name={task.kind === 'write' ? 'edit' : 'thumb_up'}
          className="mt-spacing-2"
        />
        <span className="flex flex-col gap-spacing-4">
          <span className="text-type-ui-m-bold">{heading}</span>
          <span className="text-type-body-s">{why}</span>
        </span>
      </header>

      <Quote label="可疑訊息">{task.articleText}</Quote>

      {task.kind === 'rate' && (
        <Quote label={<ReplyTypeLabel type={task.replyType} />}>
          {task.replyText}
        </Quote>
      )}

      {task.kind === 'write' ? (
        <div className="flex flex-wrap gap-spacing-8">
          <a
            href={articleHref(task.articleId)}
            className={cn(
              buttonVariants({ variant: 'secondary', withIcon: true }),
            )}
          >
            <MaterialIcon name="edit" />
            撰寫查核回應
          </a>
        </div>
      ) : state === 'UPVOTE' || state === 'DOWNVOTE' ? (
        <p
          role="status"
          className="flex items-center gap-spacing-4 text-type-ui-s-bold"
        >
          <MaterialIcon name="check_circle" filled />
          已記下你的評價（{state === 'UPVOTE' ? '有幫助' : '沒有幫助'}），謝謝！
          <a
            href={articleHref(task.articleId)}
            className="ml-auto text-type-ui-s underline"
          >
            補充說明
          </a>
        </p>
      ) : (
        <div className="flex flex-col gap-spacing-8">
          <div className="grid grid-cols-2 gap-spacing-8">
            {(
              [
                ['UPVOTE', 'thumb_up', '有幫助'],
                ['DOWNVOTE', 'thumb_down', '沒有幫助'],
              ] as const
            ).map(([value, icon, label]) => (
              <Button
                key={value}
                variant="outline"
                iconStart={icon}
                className="bg-surface-base"
                disabled={state === 'pending'}
                onClick={() => void vote(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {state === 'error' && (
            <p role="alert" className="text-type-ui-s">
              沒有送出成功，請再試一次。
            </p>
          )}
        </div>
      )}
    </article>
  )
}
