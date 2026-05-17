import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/chatSessions.functions'
import { ChatInput } from '@/components/ChatInput'
import { WelcomeHero } from '@/components/WelcomeHero'
import { isAuthExpiredError } from '@/lib/authExpired'

export const Route = createFileRoute('/_app/')({
  component: LandingPage,
})

function LandingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const sessionId = crypto.randomUUID()
      const title = text.length > 40 ? text.slice(0, 40) + '...' : text
      await createSession({ data: { sessionId, name: title } })
      return { sessionId, text }
    },
    onSuccess: ({ sessionId, text }) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      sendChatMessage(queryClient, sessionId, text)
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
        onSend={(text) => sendMutation.mutate(text)}
        disabled={sendMutation.isPending}
        placeholder="貼上想查核的訊息，或輸入 Cofacts 文章連結 (https://cofacts.tw/article/...)..."
      />
      {inlineError && (
        <div className="mt-2 text-sm text-red-500 text-center">
          {inlineError}
        </div>
      )}
    </WelcomeHero>
  )
}
