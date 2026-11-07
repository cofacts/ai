// The report form: paste a suspicious message, find out whether Cofacts already
// has it, and either add your voice to an existing report or file a new one.
//
// Deliberately not a conversation. Everything filed here is public, and a form
// is the right container for that — it shows exactly what will be submitted,
// with no model in between deciding what the user meant. The AI is one button
// away at the end, by which point there is an article for it to work on, which
// is the only input `ai_writer` has ever wanted.
//
// It sits OUTSIDE the `_ai` layout on purpose: `_ai` swaps its whole outlet for
// `LoggedOutLanding` when there is no user and pins the page to the viewport,
// and this page needs its own heading and "sign in to report" copy in that
// state, and scrolls the document like any other page. The site nav comes from
// `__root`.

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'

import type {
  ReportOutcomeArticleQueryVariables,
  SearchSuspiciousMessagesQueryVariables,
} from '@/server/gql/graphql'
import type {
  CreateArticleReportInput,
  ReportOutcomeArticle,
  RequestFactCheckInput,
  SearchCandidate,
} from '@/server/report.server'
import { LoginPrompt } from '@/components/LoginPrompt'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FactCheckReplyCard } from '@/components/FactCheckReplyCard'
import { SuspiciousMessageCard } from '@/components/SuspiciousMessageCard'
import { useAuth } from '@/lib/auth'
import { isAuthExpiredError } from '@/lib/authExpired'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/chatSessions.functions'
import {
  fetchReportOutcome,
  fileArticleReport,
  findSimilarReports,
  recordFactCheckRequest,
} from '@/server/report.server'

// Only this page calls these, so they live beside it. Each is an RPC wrapper
// plus its input check; the Cofacts calls themselves are in report.server.ts,
// where they can be tested. They pass the trimmed text through to rumors-api.

const searchSuspiciousMessages = createServerFn({ method: 'GET' })
  .inputValidator((text: SearchSuspiciousMessagesQueryVariables['like']) => {
    if (typeof text !== 'string') throw new Error('url must be text')
    return text.trim()
  })
  .handler(({ data: like }) => findSimilarReports(like))

const getReportOutcomeArticle = createServerFn({ method: 'GET' })
  .inputValidator(
    (articleId: ReportOutcomeArticleQueryVariables['id']) => articleId,
  )
  .handler(({ data: articleId }) => fetchReportOutcome(articleId))

const requestFactCheck = createServerFn({ method: 'POST' })
  .inputValidator((input: RequestFactCheckInput) => {
    if (!input.articleId) throw new Error('articleId is required')
    return input
  })
  .handler(({ data }) => recordFactCheckRequest(data))

const createArticleReport = createServerFn({ method: 'POST' })
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
  .handler(({ data }) => fileArticleReport(data))

export const Route = createFileRoute('/report')({
  component: ReportPage,
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
      /**
       * Set when we added their +1 because nobody had answered it yet: how many
       * people are waiting, counting them. Read back from the +1 itself, since
       * `article` was fetched before it.
       */
      communityDemandCount?: number
    }

function ReportPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [urlError, setUrlError] = useState<UrlError>(null)
  const [candidates, setCandidates] = useState<Array<SearchCandidate> | null>(
    null,
  )
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // The one way a new article gets filed: straight after a search that found
  // nothing, or when the reporter says none of the candidates is theirs.
  const fileNew = useMutation({
    mutationFn: (submitted: string) =>
      createArticleReport({ data: { url: submitted, reason } }),
    onSuccess: ({ articleUrl }) => {
      // /articles caches its list for a minute; a new article should show there.
      void queryClient.invalidateQueries({ queryKey: ['ListArticles'] })
      setOutcome({ kind: 'created', articleUrl })
    },
  })

  // Search first, always. Filing straight away is what produces the duplicates
  // that make the database harder to search for everyone after you.
  const startReport = useMutation({
    mutationFn: (submitted: string) =>
      searchSuspiciousMessages({ data: submitted }),
    // Returning the filing keeps this mutation pending until it settles, so
    // the form never looks idle between "nothing found" and "filed".
    onSuccess: (found, submitted) => {
      if (found.length === 0) return fileNew.mutateAsync(submitted)
      setCandidates(found)
    },
  })

  const pickCandidate = useMutation({
    mutationFn: async (articleId: string): Promise<Outcome> => {
      const found = await getReportOutcomeArticle({ data: articleId })
      if (!found) throw new Error('找不到這則訊息')
      const matched: Outcome = { kind: 'matched', ...found }
      // Nobody has answered it yet: register the demand. That +1 is what tells
      // volunteers which messages people are actually asking about. The same
      // signal decides what the outcome screen shows, so the two cannot
      // disagree about whether there is an answer.
      if (found.article.articleReplies.length > 0) return matched
      const { communityDemandCount } = await requestFactCheck({
        data: { articleId, reason },
      })
      void queryClient.invalidateQueries({ queryKey: ['ListArticles'] })
      return { ...matched, communityDemandCount }
    },
    onSuccess: setOutcome,
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

  const mutations = [startReport, pickCandidate, fileNew, discussWithAi]
  const busy = mutations.some((m) => m.isPending)

  // AUTH_EXPIRED opens the login modal through the global MutationCache
  // handler; only anything else deserves an inline message.
  const failure = mutations
    .map((m) => m.error)
    .find((err) => err && !isAuthExpiredError(err))

  // Only reached once the browser's constraint validation has passed: the
  // form refuses to submit anything but one http(s) link.
  function submit() {
    clearMutations()
    startReport.mutate(url.trim())
  }

  // Every action starts from a clean slate: a chained filing leaves its error
  // on both startReport and fileNew, and resetting only the one being re-run
  // would keep the other's stale message on screen.
  function clearMutations() {
    mutations.forEach((m) => m.reset())
  }

  // A fresh form, not the last report's: the previous link and reason would
  // otherwise ride along into the next report, and a second link pasted into
  // the field would land after the first.
  function startOver() {
    setUrl('')
    setReason('')
    setUrlError(null)
    setCandidates(null)
    setOutcome(null)
    clearMutations()
  }

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-spacing-24 px-spacing-20 py-spacing-32">
      <div className="flex flex-col gap-spacing-8 text-center">
        <h1 className="text-type-heading-l text-text-primary">
          幫忙攔下正在傳的假訊息
        </h1>
        <p className="text-type-body-m text-text-secondary">
          貼上訊息的網址 —— 有連結，大家才能確認它真的在流傳
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
          onPick={(id) => {
            clearMutations()
            pickCandidate.mutate(id)
          }}
          onNoneMatch={() => {
            clearMutations()
            fileNew.mutate(url)
          }}
          busy={busy}
        />
      ) : (
        <ReportForm
          url={url}
          onUrlChange={setUrl}
          urlError={urlError}
          onUrlErrorChange={setUrlError}
          reason={reason}
          onReasonChange={setReason}
          onSubmit={submit}
          busy={busy}
        />
      )}

      {busy && (
        <p
          role="status"
          className="text-center text-type-body-s text-text-secondary"
        >
          {startReport.isPending && !fileNew.isPending
            ? '正在查看有沒有人回報過…'
            : discussWithAi.isPending
              ? '正在開啟對話…'
              : '處理中…'}
        </p>
      )}

      {failure && (
        <p
          role="alert"
          className="text-center text-type-body-s text-status-incorrect"
        >
          {failure instanceof Error ? failure.message : '送出失敗，請再試一次'}
        </p>
      )}
    </main>
  )
}

/**
 * Why the link field refuses what is in it, or null when it shows nothing.
 * Kept in the page so "再回報一則" can clear it with the rest of the form.
 */
type UrlError = 'missing' | 'format' | null

function urlErrorOf(input: HTMLInputElement): UrlError {
  if (input.validity.valid) return null
  return input.validity.valueMissing ? 'missing' : 'format'
}

function ReportForm({
  url,
  onUrlChange,
  urlError,
  onUrlErrorChange,
  reason,
  onReasonChange,
  onSubmit,
  busy,
}: {
  url: string
  onUrlChange: (value: string) => void
  urlError: UrlError
  onUrlErrorChange: (error: UrlError) => void
  reason: string
  onReasonChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <form
      className="flex flex-col gap-spacing-16"
      // Native constraint validation guards the submit: the handler only runs
      // once the field holds one http(s) link.
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <Field>
        <Label htmlFor="report-url">訊息的網址</Label>
        {/* A visible hint rather than a placeholder, which is not a label and
            disappears the moment the reporter starts pasting. */}
        <p
          id="report-url-hint"
          className="text-type-body-s text-text-secondary"
        >
          例：https://www.facebook.com/share/p/…
        </p>
        {/*
          The error appears only when the reporter tries to submit (the
          input's `invalid` event) — never on load, while typing, or on blur.
          Shown on blur, it would push the submit button down between press
          and release and swallow the click (a tap on mobile, where focus
          moves only after the finger lifts, included); shown by the submit
          itself, nothing moves under the pointer. Once shown, editing keeps it
          accurate and clears it as soon as the value is valid. The browser's
          own bubble is suppressed because our message carries a link it
          cannot show.
        */}
        <Input
          id="report-url"
          type="url"
          name="url"
          required
          // An http(s) link and nothing else.
          // - The scheme in any case (an auto-capitalised "Https://"),
          //   spelled out per letter: the `i` regex modifier isn't Baseline.
          // - No whitespace inside, so words after the link, separated by a
          //   space, are refused rather than filed with it.
          // - Whitespace around it is fine (copying often brings a trailing
          //   space or newline): Chrome checks the pattern against the
          //   untrimmed value, and submit trims.
          pattern="\s*[Hh][Tt][Tt][Pp][Ss]?://\S+\s*"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          value={url}
          onChange={(e) => {
            onUrlChange(e.target.value)
            // Only ever clears (or keeps accurate) a message already shown.
            if (urlError) onUrlErrorChange(urlErrorOf(e.currentTarget))
          }}
          onInvalid={(e) => {
            e.preventDefault()
            onUrlErrorChange(urlErrorOf(e.currentTarget))
            e.currentTarget.focus()
          }}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={
            urlError ? 'report-url-hint report-url-error' : 'report-url-hint'
          }
        />
        {urlError && (
          <FieldError id="report-url-error">
            {urlError === 'missing'
              ? '請貼上訊息的網址。'
              : '這裡只能放一個網址，例如 https:// 開頭的連結。'}
            如果是在 LINE 上收到、沒有網址可以附，請改用{' '}
            <a
              href="https://line.me/R/ti/p/%40cofacts"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Cofacts LINE 機器人
            </a>
            回報。
          </FieldError>
        )}
      </Field>

      {/*
        Wording taken verbatim from the LINE bot's ReplyRequestForm
        (rumors-line-bot src/liff/components/ReplyRequestForm.svelte, zh_TW).
        Cofacts has asked this exact question for years; its own copy names who
        reads the answer, which is what makes people write one.
      */}
      <Field>
        <Label htmlFor="report-reason">
          <span>
            為了協助查證，請告訴闢謠志工：
            <br />
            為何您覺得這是謠言？
          </span>
        </Label>
        <Textarea
          id="report-reason"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="例：我用 OO 關鍵字查詢 Facebook，發現⋯⋯ / 我在 XX 官網上找到不一樣的說法如下⋯⋯"
        />
      </Field>

      <p className="text-type-caption text-text-secondary">
        送出後這則訊息會公開在 Cofacts
        資料庫，請不要包含姓名、電話、地址、訂單編號等個人資料。
      </p>

      <Button
        type="submit"
        size="lg"
        className="self-center"
        // Not disabled while empty: submitting is what lets validation
        // explain what the field needs. Busy only, so it can't double-post.
        disabled={busy}
      >
        回報此訊息
      </Button>
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
    <div className="flex flex-col gap-spacing-12">
      <div className="flex flex-col gap-spacing-4 text-center">
        <h2 className="text-type-heading-m text-text-primary">
          有人回報過類似的訊息
        </h2>
        <p className="text-type-body-s text-text-secondary">
          可以先點「查看這則訊息」確認內容。選了「就是這則」之後，如果還沒有人回應，會幫你一起請求查核。
        </p>
      </div>
      {candidates.map(({ node, articleUrl }) => (
        <SuspiciousMessageCard
          key={node.id}
          text={node.text}
          articleType={node.articleType}
          factCheckCount={node.replyCount}
          communityDemandCount={node.replyRequestCount}
          viewHref={articleUrl}
          onSelect={() => onPick(node.id)}
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
  if (outcome.kind === 'created') {
    return (
      <OutcomeShell
        title="感謝回報，你是第一個發現他的！"
        subtitle="資料庫裡沒有相符的紀錄，這則訊息已經收進來，等待查核。"
        onDiscuss={onDiscuss}
        busy={busy}
        secondaryHref={outcome.articleUrl}
        secondaryLabel="檢視回報的訊息"
        onStartOver={onStartOver}
      />
    )
  }

  const { article, communityDemandCount } = outcome
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
          : `目前還沒有查核結論，已經幫你一起請求查核了——現在有 ${communityDemandCount} 個人在等答案。`
      }
      onDiscuss={onDiscuss}
      busy={busy}
      secondaryHref={outcome.articleUrl}
      secondaryLabel="我來動手查"
      onStartOver={onStartOver}
    >
      {hasReplies && (
        <div className="flex flex-col gap-spacing-12">
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
  onDiscuss,
  busy,
  secondaryHref,
  secondaryLabel,
  onStartOver,
  children,
}: {
  title: string
  subtitle: string
  onDiscuss: () => void
  busy: boolean
  secondaryHref: string
  secondaryLabel: string
  onStartOver: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-spacing-16">
      <div className="flex flex-col gap-spacing-4 text-center">
        <h2 className="text-type-heading-m text-text-primary">{title}</h2>
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
      <button
        type="button"
        onClick={onStartOver}
        className="self-center text-type-body-s text-text-secondary underline"
      >
        再回報一則
      </button>
    </div>
  )
}
