// /report/check — has anyone reported this link already?
//
// Shows Penpot 02-回報可疑訊息Loading頁面 while it searches, then either the
// candidates (no Penpot board yet) or — when there are none — files the link
// straight away and moves on to 03-第一個發現他. Picking a candidate adds the
// reporter's +1 (skipped only when it is answered and they gave no reason);
// 都不是 files a new article. As in
// rumors-line-bot, an identical candidate hides 都不是, and is picked for the
// reporter when it is the only one.
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
import { useCallback, useEffect, useRef } from 'react'

import { ReportShell } from './-components/ReportShell'
import { REASON_DRAFT, URL_DRAFT } from './-lib'
import type { HistoryState } from '@tanstack/react-router'
import type {
  CreateArticleReportMutationVariables,
  RequestFactCheckMutationVariables,
  SearchSuspiciousMessagesQuery,
} from '@/server/gql/graphql'
import { Button } from '@/components/ui/button'
import { SuspiciousMessageCard } from '@/components/SuspiciousMessageCard'
import { clearSessionStorageDraft } from '@/hooks/useSessionStorageDraft'
import { useAuth } from '@/lib/auth'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'
import { cofactsExec } from '@/server/cofacts.server'
import { getArticleUrl } from '@/server/cofactsSite'
import { graphql } from '@/server/gql'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** What the /report form hands to /report/check. */
    url?: string
    reason?: string
    /**
     * What /report/check did, for /report/$articleId: filed a new article, added
     * the reporter's +1, or matched an article without writing (it already has
     * replies).
     */
    outcome?: 'created' | 'requested' | 'matched'
  }
}

type ReportOutcome = NonNullable<HistoryState['outcome']>

/**
 * How many candidates to list. The search itself uses rumors-api's default
 * `minimumShouldMatch`, as rumors-line-bot's `searchText` does (it also lists
 * 4): listing is the loose threshold, and the strict one is `identical` below,
 * which decides whether to skip the list.
 *
 * Don't pin a higher `minimumShouldMatch` for links. rumors-api folds the
 * scraped title and summary into `like` next to the link, so every
 * `more_like_this` clause sees terms that no single field of an article holds:
 * from 80% up nothing matches through them at all, and the only hit left is
 * the exact `hyperlinks.url` match. That misses the same post shared with
 * tracking parameters (`?s=46`) or text glued on, which the default finds by
 * its identical scraped title and summary. The price is unrelated posts from
 * the same site for a link nobody has reported; each card shows the scraped
 * title so the reporter can tell them apart before picking.
 */
const CANDIDATE_LIMIT = 4

export type SearchCandidate = NonNullable<
  NonNullable<SearchSuspiciousMessagesQuery['ListArticles']>['edges']
>[number] & {
  /**
   * Where a human reads this article. Computed on the server because the site
   * base is server-only. Lets the reporter look before picking: picking is a +1.
   */
  articleUrl: string
  /**
   * Its text is the searched link, once both are normalised by `sameLink`: the
   * same message. Mirrors rumors-line-bot's identical-message handling (hide
   * 都不是; pick a lone identical candidate), but by exact equality rather than
   * its 0.95 string similarity — two links that differ by one character are
   * different posts. Identical candidates come first.
   */
  identical: boolean
}

/**
 * A link reduced to what tells two links apart: whitespace removed, and the
 * scheme and host lowercased, since both are case-insensitive (the form accepts
 * `Https://`). The rest stays as typed: paths and queries are case-sensitive,
 * and ids such as Facebook's `share/p/1HSNRpimmH` depend on it.
 */
export function sameLink(text: string): string {
  const compact = text.replace(/\s/g, '')
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(compact)
  if (!match) return compact
  const [, scheme = '', authority = '', rest = ''] = match
  // Lowercase the host only: userinfo before an `@` is case-sensitive.
  const at = authority.lastIndexOf('@')
  const host = authority.slice(at + 1).toLowerCase()
  return scheme.toLowerCase() + authority.slice(0, at + 1) + host + rest
}

// POST, not GET: a GET server function puts its input in the request URL, and
// with it the reporter's link in every request log on the way.
export const searchSuspiciousMessages = createServerFn({ method: 'POST' })
  // Shape only (text, not empty): the URL rule itself is the form's. See the
  // ADR on why the server functions don't re-check it.
  .inputValidator((like: string) => {
    if (typeof like !== 'string') throw new Error('url must be text')
    const trimmed = like.trim()
    if (!trimmed) throw new Error('Nothing to search for')
    return trimmed
  })
  .handler(async ({ data: like }): Promise<Array<SearchCandidate>> => {
    const data = await cofactsExec(
      graphql(`
        query SearchSuspiciousMessages($like: String!, $first: Int!) {
          ListArticles(
            filter: { moreLikeThis: { like: $like } }
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
                hyperlinks {
                  title
                }
              }
            }
          }
        }
      `),
      {
        like,
        first: CANDIDATE_LIMIT,
      },
    )
    const searched = sameLink(like)
    return (data.ListArticles?.edges ?? [])
      .map((edge) => ({
        ...edge,
        articleUrl: getArticleUrl(edge.node.id),
        identical: sameLink(edge.node.text ?? '') === searched,
      }))
      .sort((a, b) => Number(b.identical) - Number(a.identical))
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
      // Shape only, as in the search: an empty article is never meaningful.
      const trimmed = url.trim()
      if (!trimmed) throw new Error('Nothing to report')
      return { url: trimmed, reason }
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
  const search = useQuery({
    ...searchQuery(url),
    // No url once this page is being left (the state is gone): nothing to search.
    enabled: !!user && !!url,
    // Every visit searches afresh: the automatic steps below must never act
    // on a cached result from before the last report.
    refetchOnMount: 'always',
    // Once the candidates are on screen they stay put: a refetch on returning
    // to the tab could change them under the reporter.
    refetchOnWindowFocus: false,
  })

  // The search counts and the article lists change with every write here.
  function invalidateAfterWrite(articleId: string) {
    void queryClient.invalidateQueries({ queryKey: ['ListArticles'] })
    // Stale only: refetched on the next visit, not right before leaving.
    void queryClient.invalidateQueries({
      queryKey: ['SearchSuspiciousMessages'],
      refetchType: 'none',
    })
    void queryClient.invalidateQueries({
      queryKey: ['ReportOutcomeArticle', articleId],
    })
  }

  // The report is done: the form's draft goes, and the outcome screen learns
  // what happened from history state.
  const showOutcome = useCallback(
    (articleId: string, outcome: ReportOutcome, replace: boolean) => {
      clearSessionStorageDraft(URL_DRAFT, REASON_DRAFT)
      return navigate({
        to: '/report/$articleId',
        params: { articleId },
        state: { outcome },
        replace,
      })
    },
    [navigate],
  )

  const pickCandidate = useMutation({
    mutationFn: async (candidate: SearchCandidate) => {
      const articleId = candidate.node.id
      // Already answered and nothing to add: no write. With a reason, the +1
      // still goes in, so the reporter's words reach the volunteers.
      if (candidate.node.replyCount && !reason.trim()) {
        return { articleId, requested: false }
      }
      // Register the demand. That +1 is what tells volunteers which messages
      // people are actually asking about.
      await requestFactCheck({ data: { articleId, reason } })
      invalidateAfterWrite(articleId)
      return { articleId, requested: true }
    },
  })

  // The one way a new article gets filed: straight after a search that found
  // nothing, or when the reporter says none of the candidates is theirs.
  const fileNew = useMutation({
    mutationFn: () => createArticleReport({ data: { url, reason } }),
    // On the mutation itself: the caches go stale whether or not the reporter
    // is still here.
    onSuccess: ({ articleId }) => invalidateAfterWrite(articleId),
  })

  // Showing the outcome clears the shared draft and navigates, so it must only
  // happen while this page is still open. A reporter who goes Back while a
  // write is in flight and starts another report would otherwise lose the new
  // draft and be pulled to the old article when the old write finishes.
  // Callbacks passed to mutate() run only while this component is subscribed;
  // the ones on useMutation() run regardless. The write itself still lands.
  // useMutation returns a new object every render, but its `mutate` is
  // stable, so these are built from `mutate` and stay stable too.
  const { mutate: mutatePick } = pickCandidate
  const { mutate: mutateFile } = fileNew
  const pick = useCallback(
    (candidate: SearchCandidate, replace: boolean) =>
      mutatePick(candidate, {
        onSuccess: ({ articleId, requested }) =>
          void showOutcome(
            articleId,
            requested ? 'requested' : 'matched',
            replace,
          ),
      }),
    [mutatePick, showOutcome],
  )
  const file = useCallback(
    (replace: boolean) =>
      mutateFile(undefined, {
        onSuccess: ({ articleId }) =>
          void showOutcome(articleId, 'created', replace),
      }),
    [mutateFile, showOutcome],
  )

  // Two cases decide for the reporter, as in rumors-line-bot: nothing found
  // files it now (02 → 03-第一個發現他), and a lone identical candidate is
  // picked. Both replace this entry, since the reporter never saw a choice
  // here; Back goes to the form. Only the first successful search of a visit
  // decides, whether or not it acts: once the reporter has seen candidates, a
  // later result must not file or +1 on their behalf. The ref survives
  // StrictMode's double effect. A failed automatic step is retried by hand
  // (再試一次), not by this effect.
  const top = search.data?.[0]
  const identical = !!top && top.identical
  const nothingFound = search.data?.length === 0
  const autoPick = identical && search.data?.length === 1 ? top : undefined
  const decided = useRef(false)
  // A failed refetch keeps the old data, so that doesn't count either.
  const searchedNow =
    search.isFetchedAfterMount && !search.isFetching && !search.isError
  useEffect(() => {
    if (decided.current || !searchedNow) return
    decided.current = true
    if (nothingFound) file(true)
    else if (autoPick) pick(autoPick, true)
  }, [searchedNow, nothingFound, autoPick, file, pick])

  const busy = pickCandidate.isPending || fileNew.isPending

  return (
    <ReportShell errors={[search.error, pickCandidate.error, fileNew.error]}>
      {search.isError ||
      (nothingFound && fileNew.isError) ||
      (autoPick && pickCandidate.isError) ? (
        // The search or the automatic step failed; the error shows below.
        <Button
          className="self-center"
          onClick={() =>
            search.isError
              ? void search.refetch()
              : autoPick
                ? pick(autoPick, true)
                : file(true)
          }
        >
          再試一次
        </Button>
      ) : search.isPending || nothingFound || autoPick ? (
        <p
          role="status"
          className="text-center text-type-body-m text-text-secondary"
        >
          {busy ? '處理中…' : '正在查看有沒有人回報過…'}
        </p>
      ) : (
        <CandidateView
          candidates={search.data}
          onPick={(candidate) => {
            fileNew.reset()
            pick(candidate, false)
          }}
          // An identical message is listed: it is the one (rumors-line-bot
          // hides "none of these" the same way).
          onNoneMatch={
            identical
              ? undefined
              : () => {
                  pickCandidate.reset()
                  file(false)
                }
          }
          busy={busy}
        />
      )}
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
  /** Omitted when an identical candidate is listed. */
  onNoneMatch?: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-spacing-12">
      <div className="flex flex-col gap-spacing-4 text-center">
        <h2 className="text-type-heading-m text-text-primary">
          有人回報過類似的訊息
        </h2>
        <p className="text-type-body-s text-text-secondary">
          可以先點「查看這則訊息」確認內容。選了「就是這則」之後，如果還沒有人回應，或你有填理由，會幫你一起請求查核。
        </p>
      </div>
      {candidates.map((candidate) => (
        <SuspiciousMessageCard
          key={candidate.node.id}
          text={candidate.node.text}
          linkTitle={candidate.node.hyperlinks?.find((h) => h?.title)?.title}
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
      {onNoneMatch && (
        <Button
          variant="outline"
          className="self-center"
          onClick={onNoneMatch}
          disabled={busy}
        >
          都不是，我要回報新的
        </Button>
      )}
    </div>
  )
}
