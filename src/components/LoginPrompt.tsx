import { useAuth } from '@/lib/auth'

interface LoginPromptProps {
  message: string
}

export function LoginPrompt({ message }: LoginPromptProps) {
  const { login } = useAuth()
  return (
    <div className="border-t border-border-subtle bg-surface-base p-spacing-16 flex flex-col items-center gap-spacing-12">
      <p className="text-type-body-s text-text-secondary text-center">
        {message}
      </p>
      <button
        type="button"
        onClick={() => login()}
        className="px-spacing-16 py-[6px] rounded-full bg-surface-accent text-text-on-accent text-type-body-s hover:bg-surface-accent-subtle cursor-pointer"
      >
        登入 / 註冊
      </button>
    </div>
  )
}
