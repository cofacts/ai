import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type {
  ContributionEntry,
  ContributionKind,
  ContributionTask,
  FeedbackVoteValue,
  RateTask,
  VotedTask,
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
  task: RateTask,
  vote: FeedbackVoteValue,
) => Promise<void>

/**
 * 我的貢獻 timeline: what the user did, newest first, with slots of cards for what they could do
 * next in between (one slot on top, then one every three entries). A rated card collapses to a
 * line and the next card appears right under it, so the user can keep rating without
 * scrolling. Older entries load as the user reaches the end. Contributions only add up; nothing
 * here goes away when the user is inactive.
 */
export function ContributionFeed({
  entries,
  slots,
  voted,
  onVote,
  hasMore,
  isLoadingMore,
  onLoadMore,
  loadMoreFailed = false,
  timelineError,
  tasksError,
}: {
  entries: ReadonlyArray<ContributionEntry>
  /** Task cards, slot by slot; a slot shows its cards together. */
  slots: ReadonlyArray<ReadonlyArray<ContributionTask>>
  /** Rated cards by `taskKey`. */
  voted: Readonly<Record<string, VotedTask>>
  onVote: VoteHandler
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  /** Loading the next page failed; the button retries. */
  loadMoreFailed?: boolean
  /** Shown in place of the entries when the timeline couldn't load. */
  timelineError?: ReactNode
  /** Shown above the list when the task cards couldn't load. */
  tasksError?: ReactNode
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const items =
    filter === 'all'
      ? interleave(entries, slots)
      : filter === 'task'
        ? interleave([], slots)
        : entries
            .filter((e) => e.kind === filter)
            .map((entry) => ({ type: 'entry' as const, entry }))
  const showsEntries = filter !== 'task' && !timelineError

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

      {filter !== 'task' && timelineError}
      {(filter === 'all' || filter === 'task') && tasksError}

      {items.length === 0 ? (
        !timelineError &&
        !(filter === 'task' && tasksError) && (
          <p className="rounded-radius-10 bg-surface-raised p-spacing-16 text-type-body-m text-text-secondary">
            {filter === 'task'
              ? '目前沒有推薦給你的事，晚點再回來看看。'
              : hasMore
                ? '已載入的紀錄裡沒有這一類，可以再載入更早的紀錄。'
                : '這裡還沒有紀錄。回報一則可疑訊息、評價一則查核回應，都會出現在這裡。'}
          </p>
        )
      ) : (
        <ol className="flex flex-col">
          {items.map((item) =>
            item.type === 'slot' ? (
              <li
                key={item.key}
                className="flex flex-col gap-spacing-8 py-spacing-8"
              >
                {item.tasks.map((task) => (
                  <TaskCard
                    key={taskKey(task)}
                    task={task}
                    voted={voted[taskKey(task)]}
                    onVote={onVote}
                  />
                ))}
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

      {showsEntries && (
        <LoadMore
          hasMore={hasMore}
          isLoading={isLoadingMore}
          failed={loadMoreFailed}
          // Only the full timeline loads by itself: a filter matching few entries would
          // otherwise page through the whole history.
          auto={filter === 'all'}
          showEnd={entries.length > 0}
          onLoadMore={onLoadMore}
        />
      )}
    </section>
  )
}

/**
 * 「載入更多」 at the end of the list. With `auto`, it also loads when the end scrolls into view;
 * the button stays for keyboard users and for when that doesn't fire.
 */
function LoadMore({
  hasMore,
  isLoading,
  failed,
  auto,
  showEnd,
  onLoadMore,
}: {
  hasMore: boolean
  isLoading: boolean
  failed: boolean
  auto: boolean
  showEnd: boolean
  onLoadMore: () => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const latest = useRef(onLoadMore)
  useEffect(() => {
    latest.current = onLoadMore
  })

  useEffect(() => {
    const el = sentinel.current
    // After a failure, wait for the button so a broken page isn't retried in a loop.
    if (!el || !auto || !hasMore || isLoading || failed) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) latest.current()
      },
      { rootMargin: '0px 0px 400px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [auto, hasMore, isLoading, failed])

  if (!hasMore) {
    return showEnd ? (
      <p className="py-spacing-8 text-center text-type-caption text-text-tertiary">
        沒有更早的紀錄了
      </p>
    ) : null
  }

  return (
    <div ref={sentinel} className="flex flex-col items-center gap-spacing-8">
      {failed && (
        <p role="alert" className="text-type-ui-s text-text-secondary">
          更早的紀錄沒有載入成功，請再試一次。
        </p>
      )}
      <Button
        variant="outline"
        disabled={isLoading}
        aria-busy={isLoading}
        onClick={onLoadMore}
      >
        {isLoading ? '載入中…' : '載入更多'}
      </Button>
    </div>
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

type VoteState = 'idle' | 'pending' | 'error'

const VOTE_TEXT: Record<FeedbackVoteValue, string> = {
  UPVOTE: '有幫助',
  DOWNVOTE: '沒有幫助',
}

const NEXT_TEXT: Record<VotedTask['next'], string> = {
  added: '下面還有一則可以評價。',
  exhausted: '目前沒有其他待評價的回應了。',
  pending: '正在找下一則可以評價的回應…',
}

/**
 * Something to do next, on the yellow card: rate a reply (one tap) or write one. Once rated it
 * collapses to one line, so the next card takes its place. The status region stays mounted, so
 * screen readers hear 「已記下」 and whether there is another card.
 */
function TaskCard({
  task,
  voted,
  onVote,
}: {
  task: ContributionTask
  voted: VotedTask | undefined
  onVote: VoteHandler
}) {
  const [state, setState] = useState<VoteState>('idle')

  const vote = async (value: FeedbackVoteValue) => {
    if (task.kind !== 'rate') return
    setState('pending')
    try {
      await onVote(task, value)
      setState('idle')
    } catch {
      setState('error')
    }
  }

  const status =
    task.kind === 'rate' ? (
      <div role="status">
        {voted && (
          <div className="flex flex-col gap-spacing-2 rounded-radius-10 bg-surface-raised px-spacing-16 py-spacing-12">
            <p className="flex min-w-0 items-center gap-spacing-8">
              <MaterialIcon
                name="check_circle"
                filled
                className="shrink-0 text-icon-default"
              />
              <span className="shrink-0 text-type-ui-s-bold text-text-primary">
                已記下：{VOTE_TEXT[voted.vote]}
              </span>
              <span className="min-w-0 flex-1 truncate text-type-body-s text-text-secondary">
                {task.articleText}
              </span>
              <a
                href={articleHref(task.articleId)}
                className="shrink-0 text-type-ui-s text-text-link underline"
              >
                補充說明
              </a>
            </p>
            <p className="pl-[32px] text-type-caption text-text-secondary">
              {NEXT_TEXT[voted.next]}
            </p>
          </div>
        )}
      </div>
    ) : null

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
    <div className="flex flex-col">
      {status}
      {/* The status region stays mounted across the vote, so it is announced. */}
      {!voted && (
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
          ) : (
            <div className="flex flex-col gap-spacing-8">
              <div className="grid grid-cols-2 gap-spacing-8">
                {(
                  [
                    ['UPVOTE', 'thumb_up'],
                    ['DOWNVOTE', 'thumb_down'],
                  ] as const
                ).map(([value, icon]) => (
                  <Button
                    key={value}
                    variant="outline"
                    iconStart={icon}
                    className="bg-surface-base"
                    disabled={state === 'pending'}
                    onClick={() => void vote(value)}
                  >
                    {VOTE_TEXT[value]}
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
      )}
    </div>
  )
}
