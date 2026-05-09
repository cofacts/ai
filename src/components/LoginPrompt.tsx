import { useAuth } from '@/lib/auth'

interface LoginPromptProps {
  message?: string
}

export function LoginPrompt({
  message = '登入後即可開始與 Cofacts.ai 對話',
}: LoginPromptProps) {
  const { login } = useAuth()
  return (
    <div className="border-t border-border-subtle bg-white p-4 flex flex-col items-center gap-3">
      <p className="text-sm text-text-muted text-center">{message}</p>
      <button
        type="button"
        onClick={() => login()}
        className="px-4 py-1.5 rounded-full bg-primary text-white text-sm font-medium hover:bg-primary/90 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        登入 / 註冊
      </button>
    </div>
  )
}
