import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { ContributionFeed } from './-components/ContributionFeed'
import { ContributionSummary } from './-components/ContributionSummary'
import { CumulativeChart } from './-components/CumulativeChart'
import { LoadError, Skeleton } from './-components/LoadState'
import { useTaskSlots } from './-components/useTaskSlots'
import type { UseQueryResult } from '@tanstack/react-query'
import type { VoteHandler } from './-components/ContributionFeed'
import type { CofactsUser } from '@/lib/auth'
import type { ContributionSummaryData } from '@/lib/contributions'
import {
  contributionSummaryQuery,
  contributionTasksQuery,
  contributionTimelineQuery,
  moreRateTasksQuery,
  voteOnReply,
} from '@/server/contributions.functions'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

/**
 * /contributions — 我的貢獻, reached from the avatar menu. Like the Google Maps contributions tab:
 * your totals and a running-total chart on top, then what you contributed, with cards for what
 * you could do next (rate a reply, write one) in between. Logged out, it asks you to log in.
 *
 * Everything here is per user and not indexed, so nothing is rendered on the server: the page
 * loads its three parts (summary, timeline, task cards) in the browser, each with its own
 * loading and error state, so one failing part doesn't take the others down.
 */
export const Route = createFileRoute('/contributions/')({
  head: () => ({
    meta: [
      { title: '我的貢獻 | Cofacts 真的假的' },
      // Per-user page: nothing for search engines here.
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: ContributionsPage,
})

function ContributionsPage() {
  const { user, login } = useAuth()
  const queryClient = useQueryClient()
  const enabled = !!user

  const summary = useQuery({ ...contributionSummaryQuery, enabled })
  const timeline = useInfiniteQuery({ ...contributionTimelineQuery, enabled })
  const tasks = useQuery({ ...contributionTasksQuery, enabled })

  const loadMoreRate = useCallback(
    (after: string) => queryClient.fetchQuery(moreRateTasksQuery(after)),
    [queryClient],
  )
  const { slots, voted, onVoted } = useTaskSlots(tasks.data, loadMoreRate)

  const onVote: VoteHandler = async (task, vote) => {
    await voteOnReply({
      data: { articleId: task.articleId, replyId: task.replyId, vote },
    })
    // The rated card collapses and the next one appears under it; nothing else moves.
    onVoted(task, vote)
    // Totals and the chart catch up (rumors-api counts the rating right away). The timeline
    // and the task pool are left alone so the list doesn't jump.
    void queryClient.invalidateQueries({
      queryKey: contributionSummaryQuery.queryKey,
    })
  }

  // null from any part (also a later timeline page): rumors-api rejected the session, which is
  // now cleared.
  const sessionRejected =
    summary.data === null ||
    tasks.data === null ||
    !!timeline.data?.pages.some((page) => page === null)

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-spacing-24 px-spacing-20 py-spacing-32 lg:px-spacing-48">
      {!user || sessionRejected ? (
        <section className="flex flex-col items-start gap-spacing-16">
          <h1 className="text-type-heading-l text-text-primary">我的貢獻</h1>
          <p className="text-type-body-m text-text-secondary">
            登入後，這裡會列出你回報的可疑訊息、寫過的查核回應和給過的評價，也會推薦你接下來可以幫忙的訊息。
          </p>
          <Button
            iconStart="account_circle"
            onClick={() => login('/contributions')}
          >
            登入 / 註冊
          </Button>
        </section>
      ) : (
        <>
          <SummaryBlock user={user} summary={summary} />

          {timeline.isPending ? (
            <Skeleton
              label="正在載入貢獻紀錄"
              blocks={['h-[28px] w-1/3', 'h-[200px]', 'h-[72px]', 'h-[72px]']}
            />
          ) : (
            <ContributionFeed
              entries={
                timeline.data?.pages.flatMap((page) => page?.entries ?? []) ??
                []
              }
              slots={slots}
              voted={voted}
              onVote={onVote}
              hasMore={timeline.hasNextPage}
              isLoadingMore={timeline.isFetchingNextPage}
              onLoadMore={() => void timeline.fetchNextPage()}
              loadMoreFailed={timeline.isFetchNextPageError}
              timelineError={
                timeline.isError && !timeline.data ? (
                  <LoadError
                    message="貢獻紀錄沒有載入成功。"
                    onRetry={() => void timeline.refetch()}
                  />
                ) : undefined
              }
              tasksLoading={tasks.isPending}
              tasksError={
                tasks.isError ? (
                  <LoadError
                    message="推薦你做的事沒有載入成功。"
                    onRetry={() => void tasks.refetch()}
                  />
                ) : undefined
              }
            />
          )}
        </>
      )}
    </main>
  )
}

function SummaryBlock({
  user,
  summary,
}: {
  user: CofactsUser
  summary: UseQueryResult<ContributionSummaryData | null>
}) {
  if (summary.isPending) {
    return (
      <Skeleton
        label="正在載入貢獻總覽"
        blocks={['h-[64px]', 'h-[80px]', 'h-[200px]']}
      />
    )
  }
  if (summary.isError) {
    return (
      <>
        {/* The page still needs a heading when the summary (which has it) fails. */}
        <h1 className="text-type-heading-l text-text-primary">我的貢獻</h1>
        <LoadError
          message="貢獻總覽沒有載入成功。"
          onRetry={() => void summary.refetch()}
        />
      </>
    )
  }
  if (!summary.data) return null
  return (
    <>
      <ContributionSummary
        profile={user}
        user={summary.data.user}
        totals={summary.data.totals}
        upvotesReceived={summary.data.upvotesReceived}
      />
      <CumulativeChart series={summary.data.series} />
    </>
  )
}
