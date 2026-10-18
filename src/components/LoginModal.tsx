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
    className: 'bg-[#1976D2] text-on-accent hover:bg-[#155fa3]',
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: GithubIcon,
    className: 'bg-[#2B414D] text-on-accent hover:bg-[#1e2f38]',
  },
  {
    id: 'google',
    label: 'Google',
    icon: GoogleIcon,
    className: 'bg-base text-secondary border border-subtle hover:bg-raised',
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
        <div className="flex flex-col gap-8 pt-8">
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
                className={`relative flex items-center justify-center rounded-full px-48 py-12 text-body-s uppercase transition-colors    ${p.className}`}
              >
                <Icon className="absolute left-16 h-28 w-28" />
                <span>{p.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-secondary mt-16 text-caption">
          登入即代表您同意{' '}
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary"
          >
            使用者條款
          </a>
          ，並您的貢獻將以{' '}
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary"
          >
            創用 CC 姓名標示-相同方式分享 4.0
          </a>
          ，由{' '}
          <a
            href={EDITOR_FACEBOOK_GROUP}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary"
          >
            Cofacts 真的假的訊息回報機器人與查證協作社群
          </a>{' '}
          發布。
        </p>
      </DialogContent>
    </Dialog>
  )
}
