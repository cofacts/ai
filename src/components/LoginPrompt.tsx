import { Button } from '@/components/ui/button'
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
      <Button onClick={() => login()}>登入 / 註冊</Button>
    </div>
  )
}
