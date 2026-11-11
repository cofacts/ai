import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import { ContributionFeed } from './-components/ContributionFeed'
import { ContributionSummary } from './-components/ContributionSummary'
import { CumulativeChart } from './-components/CumulativeChart'
import type { VoteHandler } from './-components/ContributionFeed'
import {
  myContributionsQuery,
  voteOnReply,
} from '@/server/contributions.functions'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

/**
 * /contributions — 我的貢獻, reached from the avatar menu. Like the Google Maps contributions tab:
 * your totals and a running-total chart on top, then what you contributed, with cards for what
 * you could do next (rate a reply, write one) in between. Logged out, it asks you to log in.
 */
export const Route = createFileRoute('/contributions/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(myContributionsQuery)
  },
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
  const { data } = useSuspenseQuery(myContributionsQuery)

  const onVote: VoteHandler = async (task, vote) => {
    await voteOnReply({
      data: { articleId: task.articleId, replyId: task.replyId, vote },
    })
    // Mark stale without refetching now: the card stays in place showing「已記下」, and the
    // totals and timeline catch up on the next visit.
    await queryClient.invalidateQueries({
      queryKey: myContributionsQuery.queryKey,
      refetchType: 'none',
    })
  }

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-spacing-24 px-spacing-20 py-spacing-32 lg:px-spacing-48">
      {data && user ? (
        <>
          <ContributionSummary
            profile={user}
            user={data.user}
            totals={data.totals}
            upvotesReceived={data.upvotesReceived}
          />
          <CumulativeChart series={data.series} />
          <ContributionFeed
            entries={data.timeline}
            tasks={data.tasks}
            onVote={onVote}
          />
        </>
      ) : (
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
      )}
    </main>
  )
}
