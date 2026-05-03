import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { sendChatMessage } from '@/lib/chatCache'
import { createSession } from '@/lib/sessions.functions'
import { ChatInput } from '@/components/ChatInput'

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
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      {/* Welcome */}
      <div className="max-w-2xl w-full text-center space-y-6">
        <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-white font-bold text-2xl mx-auto shadow-lg">
          C
        </div>
        <h1 className="text-2xl font-bold text-text-main">
          歡迎使用 Cofacts.ai
        </h1>
        <p className="text-text-muted leading-relaxed">
          貼上可疑訊息或 Cofacts 文章連結，AI 協助您進行查核、撰寫回應。
        </p>
      </div>

      {/* Input */}
      <div className="max-w-2xl w-full mt-8">
        <ChatInput
          onSend={handleSend}
          disabled={isLoading}
          placeholder="貼上想查核的訊息，或輸入 Cofacts 文章連結 (https://cofacts.tw/article/...)..."
        />
        {error && (
          <div className="mt-2 text-sm text-red-500 text-center">{error}</div>
        )}
      </div>
    </div>
  )
}
