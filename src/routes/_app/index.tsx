import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReportSearch } from '@/lib/report'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/chatSessions.functions'
import { ChatInput } from '@/components/ChatInput'
import { WelcomeHero } from '@/components/WelcomeHero'
import { isAuthExpiredError } from '@/lib/authExpired'
import { buildReportPrefill } from '@/lib/report'

// Share entry point. Android's Web Share Target, the iOS shortcut and the LINE
// bot's hand-off links all arrive here rather than at a dedicated /report page:
// when logged out, `_app.tsx` swaps the whole outlet for `LoggedOutLanding`
// regardless of which route matched, and login returns to
// `window.location.pathname + search`, so the parameters survive the round trip
// on any route. One less URL to keep working, and it matches the shape the LINE
// bot already links to (`cofacts.ai/?article=<id>`).
//
// Every field is optional and unknown parameters are ignored: this is the app's
// most-linked URL and a stray `?utm_source=` must not break it.
const validateSearch = (search: Record<string, unknown>): ReportSearch => ({
  url: typeof search.url === 'string' ? search.url : undefined,
  text: typeof search.text === 'string' ? search.text : undefined,
  title: typeof search.title === 'string' ? search.title : undefined,
})

export const Route = createFileRoute('/_app/')({
  component: LandingPage,
  validateSearch,
})

function LandingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = Route.useSearch()
  const prefill = buildReportPrefill(search)

  const sendMutation = useMutation({
    mutationFn: async ({
      text,
      files,
    }: {
      text: string
      files: Array<File>
    }) => {
      const sessionId = crypto.randomUUID()
      const titleSource = text || files[0]?.name || '附件'
      const title =
        titleSource.length > 40 ? titleSource.slice(0, 40) + '...' : titleSource
      await createSession({ data: { sessionId, name: title } })
      return { sessionId, text, files }
    },
    onSuccess: ({ sessionId, text, files }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      sendChatMessage(queryClient, sessionId, text, files)
      navigate({ to: '/session/$sessionId', params: { sessionId } })
    },
  })

  // AUTH_EXPIRED errors surface as a LoginModal via the global MutationCache
  // onError; the inline banner only renders non-auth failures.
  const inlineError =
    sendMutation.error && !isAuthExpiredError(sendMutation.error)
      ? sendMutation.error instanceof Error
        ? sendMutation.error.message
        : '建立工作階段失敗'
      : null

  return (
    <WelcomeHero>
      <ChatInput
        onSend={(text, files) => sendMutation.mutate({ text, files })}
        disabled={sendMutation.isPending}
        initialValue={prefill}
        placeholder="貼上可疑訊息、網址，或 Cofacts 文章連結 (https://cofacts.tw/article/...)..."
      />
      {inlineError && (
        <div className="mt-2 text-sm text-red-500 text-center">
          {inlineError}
        </div>
      )}
    </WelcomeHero>
  )
}
