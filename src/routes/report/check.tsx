// /report/check — has anyone reported this link already?
//
// Shows Penpot 02-回報可疑訊息Loading頁面 while it searches, then either the
// candidates (no Penpot board yet) or — when there are none — files the link
// straight away and moves on to 03-第一個發現他. Picking a candidate nobody has
// answered adds the reporter's +1; 都不是 files a new article.
//
// `url` and `reason` arrive in history state from the /report form, never in
// the URL: the link and the reason are the reporter's own, and a search param
// would put them in shared links, analytics and server logs. History state
// exists only in the browser, so this route renders client-only (`ssr: false`)
// and sends anyone without that state — a fresh tab, a pasted URL — back to the
// form. Refresh and Back keep the state, so they keep working.
//
// Every Cofacts call goes through cofactsExec, which attaches the reporter's
// own JWT from the HttpOnly session cookie — so what lands in Cofacts is
// attributed to the person who filed it. Searching needs no session; the two
// writes do, and resolveAdkUserIdOrThrow rejects them before any request
// reaches rumors-api.

import {
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
import { useEffect, useRef } from 'react'

import { ReportShell } from './-components/ReportShell'
import { failureMessage } from './-components/failureMessage'
import type {
  CreateArticleReportMutationVariables,
  RequestFactCheckMutationVariables,
  SearchSuspiciousMessagesQuery,
} from '@/server/gql/graphql'
import { Button } from '@/components/ui/button'
import { SuspiciousMessageCard } from '@/components/SuspiciousMessageCard'
import { useAuth } from '@/lib/auth'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'
import { cofactsExec } from '@/server/cofacts.server'
import { getArticleUrl } from '@/server/cofactsSite'
import { graphql } from '@/server/gql'

declare module '@tanstack/react-router' {
  /** What the /report form hands to /report/check. */
  interface HistoryState {
    url?: string
    reason?: string
  }
}

/** How many candidates a person can actually read before giving up. */
const CANDIDATE_LIMIT = 5

/**
 * How much of the pasted link has to match.
 *
 * The report form only accepts a URL, so `like` is always a bare link — and
 * rumors-api's default (`10<70%`) is tuned for prose and actively wrong for
 * one. A URL tokenises into `https`, `www`, `facebook`, `com`, `share` and one
 * unique id, and every Facebook link shares all but the last of those, so on
 * dev, searching for a share link nobody has reported returns 54 unrelated
 * Facebook posts, all scoring an identical 225.5. A candidate list of
 * confident-looking noise is worse than an empty one: it invites the reporter
 * to +1 somebody else's message.
 *
 * At 90% the unique id has to match too, which turns the query into the
 * question actually being asked — "has anyone posted this same link?" — and it
 * answers correctly in both directions: 1 hit for a link that is in the
 * database, 0 for one that is not. 80% is already back in the noise (50 hits).
 */
const BARE_LINK_MIN_SHOULD_MATCH = '90%'

export type SearchCandidate = NonNullable<
  NonNullable<SearchSuspiciousMessagesQuery['ListArticles']>['edges']
>[number] & {
  /**
   * Where a human reads this article. Computed on the server because the site
   * base is server-only. Lets the reporter look before picking: picking is a +1.
   */
  articleUrl: string
}

export const searchSuspiciousMessages = createServerFn({ method: 'GET' })
  .inputValidator((like: string) => {
    if (typeof like !== 'string') throw new Error('url must be text')
    return like.trim()
  })
  .handler(async ({ data: like }): Promise<Array<SearchCandidate>> => {
    const data = await cofactsExec(
      graphql(`
        query SearchSuspiciousMessages(
          $like: String!
          $first: Int!
          $minimumShouldMatch: String
        ) {
          ListArticles(
            filter: {
              moreLikeThis: {
                like: $like
                minimumShouldMatch: $minimumShouldMatch
              }
            }
            orderBy: [{ _score: DESC }]
            first: $first
          ) {
            edges {
              node {
                id
                text
                articleType
                replyCount
                replyRequestCount
              }
            }
          }
        }
      `),
      {
        like,
        first: CANDIDATE_LIMIT,
        minimumShouldMatch: BARE_LINK_MIN_SHOULD_MATCH,
      },
    )
    return (data.ListArticles?.edges ?? []).map((edge) => ({
      ...edge,
      articleUrl: getArticleUrl(edge.node.id),
    }))
  })

/** `reason` is the reporter's own words. Never a summary written for them. */
export const requestFactCheck = createServerFn({ method: 'POST' })
  .inputValidator((input: RequestFactCheckMutationVariables) => {
    if (typeof input.articleId !== 'string' || !input.articleId) {
      throw new Error('articleId is required')
    }
    if (input.reason != null && typeof input.reason !== 'string') {
      throw new Error('reason must be text')
    }
    return input
  })
  .handler(async ({ data }) => {
    await resolveAdkUserIdOrThrow()
    const result = await cofactsExec(
      graphql(`
        mutation RequestFactCheck($articleId: String!, $reason: String) {
          CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {
            id
          }
        }
      `),
      { articleId: data.articleId, reason: data.reason?.trim() || null },
    )
    if (!result.CreateOrUpdateReplyRequest) {
      throw new Error('Article not found')
    }
  })

/**
 * The mutation's own variables, except that `text` and `reference` collapse
 * into one `url`: this form files a link and nothing else, so both are derived
 * from it.
 */
type CreateArticleReportInput = Pick<
  CreateArticleReportMutationVariables,
  'reason'
> & {
  /** Where the message is circulating. Also the article's own text. */
  url: string
}

export const createArticleReport = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: CreateArticleReportInput): CreateArticleReportInput => {
      const { url, reason } = input
      if (typeof url !== 'string') throw new Error('url must be text')
      if (reason != null && typeof reason !== 'string') {
        throw new Error('reason must be text')
      }
      return { url: url.trim(), reason }
    },
  )
  .handler(async ({ data }): Promise<{ articleId: string }> => {
    await resolveAdkUserIdOrThrow()
    const result = await cofactsExec(
      graphql(`
        mutation CreateArticleReport(
          $text: String!
          $reference: ArticleReferenceInput!
          $reason: String
        ) {
          CreateArticle(text: $text, reference: $reference, reason: $reason) {
            id
          }
        }
      `),
      {
        // The URL is the article body and the reference alike — one value, so
        // the two cannot drift apart. rumors-api resolves the link at creation
        // and fills in `hyperlinks.title/summary`, which is what a reader sees.
        text: data.url,
        // Always URL. This entry point only accepts a link, so every report it
        // files can be described honestly — it never hits the missing enum
        // value that forces other non-LINE sources to be labelled LINE.
        reference: { type: 'URL', permalink: data.url },
        reason: data.reason?.trim() || null,
      },
    )
    const articleId = result.CreateArticle?.id
    if (!articleId) throw new Error('Cofacts did not return an article id')
    return { articleId }
  })

const searchQuery = (like: string) =>
  queryOptions({
    queryKey: ['SearchSuspiciousMessages', like],
    queryFn: () => searchSuspiciousMessages({ data: like }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/report/check')({
  // History state exists only in the browser. Rendered there, beforeLoad sees
  // it on refresh and Back too, and only a visit without it goes to the form.
  ssr: false,
  beforeLoad: ({ location }) => {
    if (!location.state.url) {
      throw redirect({ to: '/report', replace: true })
    }
  },
  component: ReportCheckPage,
  head: () => ({ meta: [{ title: '回報可疑訊息 — Cofacts.ai' }] }),
})

function ReportCheckPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { url = '', reason = '' } = useLocation({
    select: (location) => location.state,
  })

  // Search first, always. Filing straight away is what produces the duplicates
  // that make the database harder to search for everyone after you. Waits for
  // a user: logged out, the page shows the sign-in prompt instead.
  const search = useQuery({ ...searchQuery(url), enabled: !!user })

  // The search counts and the article lists change with every write here.
  function invalidateAfterWrite(articleId: string) {
    void queryClient.invalidateQueries({ queryKey: ['ListArticles'] })
    void queryClient.invalidateQueries({
      queryKey: ['SearchSuspiciousMessages'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ReportOutcomeArticle', articleId],
    })
  }

  const pickCandidate = useMutation({
    mutationFn: async (candidate: SearchCandidate) => {
      const articleId = candidate.node.id
      // Nobody has answered it yet: register the demand. That +1 is what tells
      // volunteers which messages people are actually asking about.
      if (candidate.node.replyCount === 0) {
        await requestFactCheck({ data: { articleId, reason } })
        invalidateAfterWrite(articleId)
      }
      return articleId
    },
    onSuccess: (articleId) =>
      navigate({ to: '/report/$articleId', params: { articleId } }),
  })

  // The one way a new article gets filed: straight after a search that found
  // nothing, or when the reporter says none of the candidates is theirs.
  const fileNew = useMutation({
    mutationFn: (_: { replace: boolean }) =>
      createArticleReport({ data: { url, reason } }),
    onSuccess: ({ articleId }, { replace }) => {
      invalidateAfterWrite(articleId)
      return navigate({
        to: '/report/$articleId',
        params: { articleId },
        search: { created: true },
        replace,
      })
    },
  })

  // Nothing found: file it now (02 → 03-第一個發現他). Once per visit — the
  // ref survives StrictMode's double effect. A second call would still be
  // harmless: CreateArticle upserts on a hash of the text, and the reply
  // request is per user. Replaces this entry, since the reporter never saw a
  // choice here; Back goes to the form.
  const autoFiled = useRef(false)
  const nothingFound = search.data?.length === 0
  useEffect(() => {
    if (!nothingFound || autoFiled.current) return
    autoFiled.current = true
    fileNew.mutate({ replace: true })
  }, [nothingFound, fileNew])

  const busy = pickCandidate.isPending || fileNew.isPending

  return (
    <ReportShell
      error={failureMessage([search.error, pickCandidate.error, fileNew.error])}
    >
      {search.isPending || nothingFound ? (
        <p
          role="status"
          className="text-center text-type-body-m text-text-secondary"
        >
          {fileNew.isPending ? '處理中…' : '正在查看有沒有人回報過…'}
        </p>
      ) : search.data ? (
        <CandidateView
          candidates={search.data}
          onPick={(candidate) => {
            fileNew.reset()
            pickCandidate.mutate(candidate)
          }}
          onNoneMatch={() => {
            pickCandidate.reset()
            fileNew.mutate({ replace: false })
          }}
          busy={busy}
        />
      ) : null}
    </ReportShell>
  )
}

function CandidateView({
  candidates,
  onPick,
  onNoneMatch,
  busy,
}: {
  candidates: Array<SearchCandidate>
  onPick: (candidate: SearchCandidate) => void
  onNoneMatch: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-spacing-12">
      <div className="flex flex-col gap-spacing-4 text-center">
        <h2 className="text-type-heading-m text-text-primary">
          有人回報過類似的訊息
        </h2>
        <p className="text-type-body-s text-text-secondary">
          可以先點「查看這則訊息」確認內容。選了「就是這則」之後，如果還沒有人回應，會幫你一起請求查核。
        </p>
      </div>
      {candidates.map((candidate) => (
        <SuspiciousMessageCard
          key={candidate.node.id}
          text={candidate.node.text}
          articleType={candidate.node.articleType}
          factCheckCount={candidate.node.replyCount}
          communityDemandCount={candidate.node.replyRequestCount}
          viewHref={candidate.articleUrl}
          onSelect={() => onPick(candidate)}
          // A second tap would race the first: a second +1, or a +1 landing
          // on one article while 都不是 files another.
          disabled={busy}
        />
      ))}
      <Button
        variant="outline"
        className="self-center"
        onClick={onNoneMatch}
        disabled={busy}
      >
        都不是，我要回報新的
      </Button>
    </div>
  )
}
