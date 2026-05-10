import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/chatSessions.functions'
import { ChatInput } from '@/components/ChatInput'
import { WelcomeHero } from '@/components/WelcomeHero'
import { handleAuthExpired, isAuthExpiredError } from '@/lib/authExpired'

export const Route = createFileRoute('/_app/')({
  component: LandingPage,
})

function LandingPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSend = useCallback(
    async (text: string) => {
      if (isLoading) return

      setIsLoading(true)
      setError(null)

      const sessionId = crypto.randomUUID()

      // Generate session title from the first message
      const title = text.length > 40 ? text.slice(0, 40) + '...' : text

      // 1. Create the session in ADK upfront
      try {
        await createSession({
          data: {
            sessionId,
            name: title,
          },
        })
      } catch (err) {
        if (isAuthExpiredError(err)) {
          handleAuthExpired(queryClient)
          setIsLoading(false)
          return
        }
        setError(err instanceof Error ? err.message : '建立工作階段失敗')
        setIsLoading(false)
        return
      }

      queryClient.invalidateQueries({ queryKey: ['sessions'] })

      // 2. Instantly seed the cache and start the background stream fetch
      sendChatMessage(queryClient, sessionId, text)

      navigate({
        to: '/session/$sessionId',
        params: { sessionId },
      })
    },
    [isLoading, navigate, queryClient],
  )

  return (
    <WelcomeHero>
      <ChatInput
        onSend={handleSend}
        disabled={isLoading}
        placeholder="貼上想查核的訊息，或輸入 Cofacts 文章連結 (https://cofacts.tw/article/...)..."
      />
      {error && (
        <div className="mt-2 text-sm text-red-500 text-center">{error}</div>
      )}
    </WelcomeHero>
  )
}
