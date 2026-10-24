import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

interface LoginPromptProps {
  message: string
}

export function LoginPrompt({ message }: LoginPromptProps) {
  const { login } = useAuth()
  return (
    <div className="border-t border-subtle bg-base p-16 flex flex-col items-center gap-12">
      <p className="text-body-s text-secondary text-center">{message}</p>
      <Button onClick={() => login()}>登入 / 註冊</Button>
    </div>
  )
}
