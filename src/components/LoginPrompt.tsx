import { useAuth } from '@/lib/auth'

interface LoginPromptProps {
  message: string
}

export function LoginPrompt({ message }: LoginPromptProps) {
  const { login } = useAuth()
  return (
    <div className="border-t border-subtle bg-base p-16 flex flex-col items-center gap-12">
      <p className="text-body-s text-secondary text-center">{message}</p>
      <button
        type="button"
        onClick={() => login()}
        className="px-16 py-6 rounded-full bg-accent text-on-accent text-body-s hover:bg-accent-subtle cursor-pointer"
      >
        登入 / 註冊
      </button>
    </div>
  )
}
