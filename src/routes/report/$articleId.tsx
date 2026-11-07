// /report/$articleId — what the reporter ends up looking at, for the article
// they picked or filed on /report/check. One of three Penpot boards:
//
// - 03-回報可疑訊息有文章且有查核回應: it already has fact-check replies;
// - 03-回報可疑訊息第一個發現他: the reporter just filed it;
// - 03-回報可疑訊息有文章但無回應: otherwise — with how many people are waiting,
//   and, when check added it, that their +1 is in.
//
// What check did arrives as `outcome` in history state. Like check, the route
// is client-only and sends a visit without that state (a fresh tab, a pasted
// link) to the form. It only reads: the writes happened on /report/check, and
// the one action here, 與 Cofacts AI 討論, opens a chat session about the
// article.

import {
  Link,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ReportShell } from './-components/ReportShell'
import type { HistoryState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import type { ReportOutcomeArticleQuery } from '@/server/gql/graphql'
import { Button, buttonVariants } from '@/components/ui/button'
import { FactCheckReplyCard } from '@/components/FactCheckReplyCard'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/chatSessions.functions'
import { cofactsExec } from '@/server/cofacts.server'
import { getArticleUrl } from '@/server/cofactsSite'
import { graphql } from '@/server/gql'

type ReportOutcomeArticle = NonNullable<ReportOutcomeArticleQuery['GetArticle']>

export const getReportOutcomeArticle = createServerFn({ method: 'GET' })
  .inputValidator((articleId: string) => {
    if (typeof articleId !== 'string') throw new Error('articleId must be text')
    return articleId
  })
  .handler(
    async ({
      data: id,
    }): Promise<{
      article: ReportOutcomeArticle
      /** Computed here because the site base is server-only. */
      articleUrl: string
    } | null> => {
      const data = await cofactsExec(
        graphql(`
          query ReportOutcomeArticle($id: String!) {
            GetArticle(id: $id) {
              id
              replyRequestCount
              articleReplies(statuses: [NORMAL]) {
                positiveFeedbackCount
                negativeFeedbackCount
                reply {
                  type
                  text
                  reference
                  user {
                    name
                  }
                }
              }
            }
          }
        `),
        { id },
      )
      if (!data.GetArticle) return null
      return {
        article: data.GetArticle,
        articleUrl: getArticleUrl(data.GetArticle.id),
      }
    },
  )

const outcomeQuery = (articleId: string) =>
  queryOptions({
    queryKey: ['ReportOutcomeArticle', articleId],
    queryFn: () => getReportOutcomeArticle({ data: articleId }),
    staleTime: 60_000,
    // An unknown id makes rumors-api error; retrying only delays the message.
    retry: false,
  })

export const Route = createFileRoute('/report/$articleId')({
  // History state exists only in the browser; see /report/check.
  ssr: false,
  beforeLoad: ({ location }) => {
    if (!location.state.outcome) {
      throw redirect({ to: '/report', replace: true })
    }
  },
  component: ReportOutcomePage,
  head: () => ({ meta: [{ title: '回報可疑訊息 — Cofacts.ai' }] }),
})

function ReportOutcomePage() {
  const { articleId } = Route.useParams()
  const outcomeKind = useLocation({
    select: (location) => location.state.outcome,
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Client-only: the screen depends on the reporter's own just-made write, and
  // nothing here needs to be in the SSR HTML.
  const outcome = useQuery(outcomeQuery(articleId))

  // Hands the article to ai_writer the way it already expects to receive one —
  // as a Cofacts article URL in a fresh session — so no new agent contract is
  // needed to get from reporting to checking.
  const discussWithAi = useMutation({
    mutationFn: async (articleUrl: string) => {
      const sessionId = crypto.randomUUID()
      await createSession({ data: { sessionId, name: articleUrl } })
      return { sessionId, articleUrl }
    },
    onSuccess: ({ sessionId, articleUrl }) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      sendChatMessage(queryClient, sessionId, articleUrl, [])
      void navigate({ to: '/session/$sessionId', params: { sessionId } })
    },
  })

  const found = outcome.data
  return (
    <ReportShell errors={[outcome.error, discussWithAi.error]}>
      {outcome.isPending ? (
        <p
          role="status"
          className="text-center text-type-body-m text-text-secondary"
        >
          處理中…
        </p>
      ) : found === null ? (
        <p className="text-center text-type-body-m text-text-secondary">
          找不到這則訊息
        </p>
      ) : found ? (
        <OutcomeView
          article={found.article}
          articleUrl={found.articleUrl}
          outcome={outcomeKind}
          onDiscuss={() => discussWithAi.mutate(found.articleUrl)}
          busy={discussWithAi.isPending}
        />
      ) : null}
      {discussWithAi.isPending && (
        <p
          role="status"
          className="text-center text-type-body-s text-text-secondary"
        >
          正在開啟對話…
        </p>
      )}
    </ReportShell>
  )
}

function OutcomeView({
  article,
  articleUrl,
  outcome,
  onDiscuss,
  busy,
}: {
  article: ReportOutcomeArticle
  articleUrl: string
  outcome: HistoryState['outcome']
  onDiscuss: () => void
  busy: boolean
}) {
  // A reply that could not be read is left out rather than given a verdict.
  const replies = article.articleReplies.flatMap(({ reply, ...ar }) =>
    reply ? [{ ...ar, reply }] : [],
  )
  const hasReplies = replies.length > 0

  if (!hasReplies && outcome === 'created') {
    return (
      <OutcomeShell
        title="感謝回報，你是第一個發現他的！"
        subtitle="資料庫裡沒有相符的紀錄，這則訊息已經收進來，等待查核。"
        onDiscuss={onDiscuss}
        busy={busy}
        secondaryHref={articleUrl}
        secondaryLabel="檢視回報的訊息"
      />
    )
  }

  return (
    <OutcomeShell
      title={
        hasReplies
          ? '感謝回報，這則已經有人查過了'
          : '感謝回報，已經有人回報過這則'
      }
      subtitle={
        hasReplies
          ? '查核結果在下面，你也可以留下看法。'
          : outcome === 'requested'
            ? `目前還沒有查核結論，已經幫你一起請求查核了——現在有 ${article.replyRequestCount ?? 0} 個人在等答案。`
            : `目前還沒有查核結論，現在有 ${article.replyRequestCount ?? 0} 個人在等答案。`
      }
      onDiscuss={onDiscuss}
      busy={busy}
      secondaryHref={articleUrl}
      secondaryLabel="我來動手查"
    >
      {hasReplies && (
        <div className="flex flex-col gap-spacing-12">
          {replies.map((ar, i) => (
            <FactCheckReplyCard
              key={i}
              type={ar.reply.type}
              text={ar.reply.text ?? ''}
              reference={ar.reply.reference}
              authorName={ar.reply.user?.name}
              helpfulCount={ar.positiveFeedbackCount}
              unhelpfulCount={ar.negativeFeedbackCount}
            />
          ))}
        </div>
      )}
    </OutcomeShell>
  )
}

// Stable, so React calls it only when the heading attaches — not on every
// re-render. OutcomeShell renders only once the article has loaded.
const focusOnMount = (el: HTMLElement | null) => el?.focus()

function OutcomeShell({
  title,
  subtitle,
  onDiscuss,
  busy,
  secondaryHref,
  secondaryLabel,
  children,
}: {
  title: string
  subtitle: string
  onDiscuss: () => void
  busy: boolean
  secondaryHref: string
  secondaryLabel: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-spacing-16">
      <div className="flex flex-col gap-spacing-4 text-center">
        {/* Focused on arrival: the button that led here is gone, and a
            screen reader would otherwise not hear that the result is in. */}
        <h2
          ref={focusOnMount}
          tabIndex={-1}
          className="text-type-heading-m text-text-primary"
        >
          {title}
        </h2>
        <p className="text-type-body-s text-text-secondary">{subtitle}</p>
      </div>
      {children}
      <div className="flex flex-wrap justify-center gap-spacing-12">
        <Button onClick={onDiscuss} disabled={busy}>
          與 Cofacts AI 討論
        </Button>
        <a
          href={secondaryHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline' })}
        >
          {secondaryLabel}
        </a>
      </div>
      {/* A fresh form, not the last report's: no state, so the previous link
          and reason don't ride along into the next report. */}
      <Link
        to="/report"
        className="self-center text-type-body-s text-text-secondary underline"
      >
        再回報一則
      </Link>
    </div>
  )
}
