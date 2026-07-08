import { useServerFn } from '@tanstack/react-start'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  FacebookIcon,
  GithubIcon,
  GoogleIcon,
} from '@/components/icons/ProviderIcons'
import { login } from '@/server/auth.functions'

const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
const EDITOR_FACEBOOK_GROUP =
  'https://www.facebook.com/groups/cofacts/permalink/1959641497601003/'
const TERMS_URL = 'https://cofacts.tw/terms'

interface ProviderConfig {
  id: 'facebook' | 'github' | 'google'
  label: string
  icon: React.ComponentType<{ className?: string }>
  className: string
}

const PROVIDERS: ReadonlyArray<ProviderConfig> = [
  {
    id: 'facebook',
    label: 'Facebook',
    icon: FacebookIcon,
    className:
      'bg-[#1976D2] text-white hover:bg-[#155fa3] focus-visible:ring-[#1976D2]/40',
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: GithubIcon,
    className:
      'bg-[#2B414D] text-white hover:bg-[#1e2f38] focus-visible:ring-[#2B414D]/40',
  },
  {
    id: 'google',
    label: 'Google',
    icon: GoogleIcon,
    className:
      'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus-visible:ring-gray-400',
  },
]

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  redirectPath?: string
}

function resolveRedirectTarget(redirectPath?: string): string {
  if (redirectPath) return redirectPath
  if (typeof window === 'undefined') return '/'
  return (
    window.location.pathname + window.location.search + window.location.hash
  )
}

export function LoginModal({
  open,
  onOpenChange,
  redirectPath,
}: LoginModalProps) {
  const startLogin = useServerFn(login)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-center">登入 / 註冊</DialogTitle>
        <div className="flex flex-col gap-2 pt-2">
          {PROVIDERS.map((p) => {
            const Icon = p.icon
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  startLogin({
                    data: {
                      provider: p.id,
                      redirectTo: resolveRedirectTarget(redirectPath),
                    },
                  })
                }
                className={`relative flex items-center justify-center rounded-full px-12 py-3 text-sm font-medium uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${p.className}`}
              >
                <Icon className="absolute left-4 h-7 w-7" />
                <span>{p.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          登入即代表您同意{' '}
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            使用者條款
          </a>
          ，並您的貢獻將以{' '}
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            創用 CC 姓名標示-相同方式分享 4.0
          </a>
          ，由{' '}
          <a
            href={EDITOR_FACEBOOK_GROUP}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Cofacts 真的假的訊息回報機器人與查證協作社群
          </a>{' '}
          發布。
        </p>
      </DialogContent>
    </Dialog>
  )
}
