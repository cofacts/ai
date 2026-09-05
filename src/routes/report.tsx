// The report form: paste a suspicious message, find out whether Cofacts already
// has it, and either add your voice to an existing report or file a new one.
//
// Deliberately not a conversation. Everything filed here is public, and a form
// is the right container for that — it shows exactly what will be submitted,
// with no model in between deciding what the user meant. The AI is one button
// away at the end, by which point there is an article for it to work on, which
// is the only input `ai_writer` has ever wanted.
//
// It sits OUTSIDE the `_app` layout on purpose: `_app` swaps its whole outlet
// for `LoggedOutLanding` when there is no user, and this page needs to keep its
// own heading and its own "sign in to report" copy in that state.

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { ReportSearch } from '@/lib/report'
import type {
  ReportOutcomeArticle,
  SearchCandidate,
} from '@/server/report.functions'
import { Header } from '@/components/Header'
import { LoginPrompt } from '@/components/LoginPrompt'
import { FactCheckReplyCard } from '@/components/cofacts/FactCheckReplyCard'
import { SuspiciousMessageCard } from '@/components/cofacts/SuspiciousMessageCard'
import { useAuth } from '@/lib/auth'
import { isAuthExpiredError } from '@/lib/authExpired'
import { buildReportPrefill, findFirstUrl } from '@/lib/report'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/chatSessions.functions'
import {
  createArticleReport,
  getReportOutcomeArticle,
  requestFactCheck,
  searchSuspiciousMessages,
} from '@/server/report.functions'

export const Route = createFileRoute('/report')({
  component: ReportPage,
  // Lenient by design: this is the URL a share sheet, an iOS shortcut and every
  // campaign link point at, and an unrecognised `?utm_source=` must not break
  // it. Unknown params are ignored rather than rejected.
  validateSearch: (search: Record<string, unknown>): ReportSearch => ({
    url: typeof search.url === 'string' ? search.url : undefined,
    text: typeof search.text === 'string' ? search.text : undefined,
    title: typeof search.title === 'string' ? search.title : undefined,
  }),
  head: () => ({
    meta: [
      { title: '回報可疑訊息 — Cofacts.ai' },
      {
        name: 'description',
        content:
          '貼上正在流傳的訊息連結，看看有沒有人回報過、有沒有查核回應，也可以請大家一起查。',
      },
    ],
  }),
})

/** What the reporter ends up looking at. */
type Outcome =
  | { kind: 'created'; articleUrl: string }
  | {
      kind: 'matched'
      articleUrl: string
      article: ReportOutcomeArticle
      /** True when we added their +1 because nobody had answered it yet. */
      requested: boolean
    }

/** `https://dev.cofacts.tw/article/xyz` -> `https://dev.cofacts.tw`. */
function siteBaseFrom(articleUrl: string): string {
  const at = articleUrl.indexOf('/article/')
  return at === -1 ? articleUrl : articleUrl.slice(0, at)
}

function ReportPage() {
  const search = Route.useSearch()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const prefill = buildReportPrefill(search)
  const [text, setText] = useState(prefill)
  const [reason, setReason] = useState('')
  const [noLink, setNoLink] = useState(false)
  const [candidates, setCandidates] = useState<Array<SearchCandidate> | null>(
    null,
  )
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  // A share sheet usually hands over a bare link and nothing else — Facebook on
  // Android sends `?text=<the link>` with no prose and no title. The link is
  // then the whole submission, and "what made this look suspicious to you" is
  // the only thing left that a machine cannot fill in, so put the cursor there.
  const sharedOnlyALink = prefill !== '' && prefill === findFirstUrl(prefill)
  useEffect(() => {
    if (sharedOnlyALink && user) reasonRef.current?.focus()
  }, [sharedOnlyALink, user])

  // Search first, always. Filing straight away is what produces the duplicates
  // that make the database harder to search for everyone after you.
  const startReport = useMutation({
    mutationFn: async (
      submitted: string,
    ): Promise<
      | { kind: 'candidates'; candidates: Array<SearchCandidate> }
      | { kind: 'created'; articleUrl: string }
    > => {
      const result = await searchSuspiciousMessages({ data: submitted })
      if (result.candidates.length > 0) {
        return { kind: 'candidates', candidates: result.candidates }
      }
      const permalink = findFirstUrl(submitted)
      if (!permalink) throw new Error('沒有找到連結')
      const created = await createArticleReport({
        data: { text: submitted, permalink, reason },
      })
      return { kind: 'created', articleUrl: created.articleUrl }
    },
    onSuccess: (result) => {
      if (result.kind === 'candidates') setCandidates(result.candidates)
      else setOutcome({ kind: 'created', articleUrl: result.articleUrl })
    },
  })

  const pickCandidate = useMutation({
    mutationFn: async (articleId: string) => {
      const found = await getReportOutcomeArticle({ data: articleId })
      if (!found) throw new Error('找不到這則訊息')
      // Nobody has answered it yet: register the demand. That +1 is what tells
      // volunteers which messages people are actually asking about.
      const requested = found.article.replyCount === 0
      if (requested) await requestFactCheck({ data: { articleId, reason } })
      return { ...found, requested }
    },
    onSuccess: ({ article, articleUrl, requested }) =>
      setOutcome({ kind: 'matched', article, articleUrl, requested }),
  })

  const fileNew = useMutation({
    mutationFn: async () => {
      const permalink = findFirstUrl(text)
      if (!permalink) throw new Error('沒有找到連結')
      return createArticleReport({ data: { text, permalink, reason } })
    },
    onSuccess: ({ articleUrl }) => setOutcome({ kind: 'created', articleUrl }),
  })

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
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      sendChatMessage(queryClient, sessionId, articleUrl, [])
      navigate({ to: '/session/$sessionId', params: { sessionId } })
    },
  })

  const busy =
    startReport.isPending ||
    pickCandidate.isPending ||
    fileNew.isPending ||
    discussWithAi.isPending

  // AUTH_EXPIRED opens the login modal through the global MutationCache
  // handler; only anything else deserves an inline message.
  const failure = [startReport.error, pickCandidate.error, fileNew.error].find(
    (err) => err && !isAuthExpiredError(err),
  )

  function submit() {
    const submitted = text.trim()
    if (!submitted) return
    if (!findFirstUrl(submitted)) {
      setNoLink(true)
      return
    }
    setNoLink(false)
    startReport.mutate(submitted)
  }

  function startOver() {
    setCandidates(null)
    setOutcome(null)
    startReport.reset()
    pickCandidate.reset()
    fileNew.reset()
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Header />
      <main className="flex-1 flex justify-center px-4 py-10">
        <div className="w-full max-w-xl flex flex-col gap-6">
          <div className="text-center flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-text-main">
              幫忙攔下正在傳的假訊息
            </h1>
            <p className="text-sm text-text-muted">
              貼上訊息的網址，或連同你收到的文字一起貼上
            </p>
          </div>

          {!user ? (
            <LoginPrompt message="登入後即可開始回報" />
          ) : outcome ? (
            <OutcomeView
              outcome={outcome}
              onDiscuss={() => discussWithAi.mutate(outcome.articleUrl)}
              onStartOver={startOver}
              busy={busy}
            />
          ) : candidates ? (
            <CandidateView
              candidates={candidates}
              onPick={(id) => pickCandidate.mutate(id)}
              onNoneMatch={() => fileNew.mutate()}
              busy={busy}
            />
          ) : (
            <ReportForm
              text={text}
              onTextChange={(value) => {
                setText(value)
                setNoLink(false)
              }}
              reason={reason}
              onReasonChange={setReason}
              reasonRef={reasonRef}
              onSubmit={submit}
              busy={busy}
              noLink={noLink}
            />
          )}

          {busy && (
            <p className="text-sm text-text-muted text-center">
              {startReport.isPending
                ? '正在查看有沒有人回報過…'
                : discussWithAi.isPending
                  ? '正在開啟對話…'
                  : '處理中…'}
            </p>
          )}

          {failure && (
            <p className="text-sm text-red-500 text-center">
              {failure instanceof Error
                ? failure.message
                : '送出失敗，請再試一次'}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

function ReportForm({
  text,
  onTextChange,
  reason,
  onReasonChange,
  reasonRef,
  onSubmit,
  busy,
  noLink,
}: {
  text: string
  onTextChange: (value: string) => void
  reason: string
  onReasonChange: (value: string) => void
  reasonRef: React.RefObject<HTMLTextAreaElement | null>
  onSubmit: () => void
  busy: boolean
  noLink: boolean
}) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={5}
        placeholder="在此輸入，記得附上訊息的網址"
        className="w-full rounded-lg border border-border-subtle p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary"
      />

      {noLink && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 flex flex-col gap-1">
          <p className="font-medium">還缺一個連結</p>
          <p>
            回報需要一個大家都點得開的網址，別人才能確認這則訊息真的在流傳。
            如果你是在 LINE 上收到、沒有網址可以附，請改用{' '}
            <a
              href="https://line.me/R/ti/p/%40cofacts"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Cofacts LINE 機器人
            </a>
            回報。
          </p>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text-main">
          你覺得哪裡可疑？
        </span>
        <span className="text-xs text-text-muted">
          選填，但這句話是機器補不上的——它會告訴接手查核的志工，該從哪裡查起。
        </span>
        <textarea
          ref={reasonRef}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border-subtle p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      <p className="text-xs text-text-muted">
        送出後這則訊息會公開在 Cofacts
        資料庫，請不要包含姓名、電話、地址、訂單編號等個人資料。
      </p>

      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="self-center px-6 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        回報此訊息
      </button>
    </form>
  )
}

function CandidateView({
  candidates,
  onPick,
  onNoneMatch,
  busy,
}: {
  candidates: Array<SearchCandidate>
  onPick: (articleId: string) => void
  onNoneMatch: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text-main">
          有人回報過類似的訊息
        </h2>
        <p className="text-sm text-text-muted">
          哪一則是你看到的？選錯了會多出一筆重複紀錄，所以看清楚再挑。
        </p>
      </div>
      {candidates.map(({ node }) => (
        <SuspiciousMessageCard
          key={node.id}
          text={node.text}
          articleType={node.articleType}
          factCheckCount={node.replyCount}
          communityDemandCount={node.replyRequestCount}
          onSelect={() => onPick(node.id)}
        />
      ))}
      <button
        type="button"
        onClick={onNoneMatch}
        disabled={busy}
        className="self-center px-6 py-2 rounded-full border border-border-subtle text-sm text-text-main hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
      >
        都不是，我要回報新的
      </button>
    </div>
  )
}

function OutcomeView({
  outcome,
  onDiscuss,
  onStartOver,
  busy,
}: {
  outcome: Outcome
  onDiscuss: () => void
  onStartOver: () => void
  busy: boolean
}) {
  const site = siteBaseFrom(outcome.articleUrl)

  if (outcome.kind === 'created') {
    return (
      <OutcomeShell
        title="感謝回報，你是第一個發現他的！"
        subtitle="資料庫裡沒有相符的紀錄，這則訊息已經收進來，等待查核。"
        primary={{ label: '與 Cofacts AI 討論', onClick: onDiscuss, busy }}
        secondaryHref={`${site}/replies`}
        secondaryLabel="看看最新查核"
        onStartOver={onStartOver}
      />
    )
  }

  const { article, requested } = outcome
  const hasReplies = article.articleReplies.length > 0

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
          : requested
            ? `目前還沒有查核結論，已經幫你一起請求查核了——現在有 ${article.replyRequestCount} 個人在等答案。`
            : '目前還沒有查核結論。'
      }
      primary={{ label: '與 Cofacts AI 討論', onClick: onDiscuss, busy }}
      secondaryHref={outcome.articleUrl}
      secondaryLabel="我來動手查"
      onStartOver={onStartOver}
    >
      {hasReplies && (
        <div className="space-y-3">
          {article.articleReplies.map((ar, i) => (
            <FactCheckReplyCard
              key={i}
              type={ar.reply?.type ?? 'NOT_ARTICLE'}
              text={ar.reply?.text ?? ''}
              reference={ar.reply?.reference}
              authorName={ar.reply?.user?.name}
              helpfulCount={ar.positiveFeedbackCount}
              unhelpfulCount={ar.negativeFeedbackCount}
            />
          ))}
        </div>
      )}
    </OutcomeShell>
  )
}

function OutcomeShell({
  title,
  subtitle,
  primary,
  secondaryHref,
  secondaryLabel,
  onStartOver,
  children,
}: {
  title: string
  subtitle: string
  primary: { label: string; onClick: () => void; busy: boolean }
  secondaryHref: string
  secondaryLabel: string
  onStartOver: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text-main">{title}</h2>
        <p className="text-sm text-text-muted">{subtitle}</p>
      </div>
      {children}
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.busy}
          className="px-6 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-hover disabled:opacity-50 cursor-pointer"
        >
          {primary.label}
        </button>
        <a
          href={secondaryHref}
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-2 rounded-full border border-border-subtle text-sm text-text-main hover:bg-gray-50"
        >
          {secondaryLabel}
        </a>
      </div>
      <button
        type="button"
        onClick={onStartOver}
        className="self-center text-sm text-text-muted underline cursor-pointer"
      >
        再回報一則
      </button>
    </div>
  )
}
