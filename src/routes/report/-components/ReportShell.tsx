import type { ReactNode } from 'react'

import { LoginPrompt } from '@/components/LoginPrompt'
import { useAuth } from '@/lib/auth'
import { isAuthExpiredError } from '@/lib/authExpired'

/**
 * The frame every /report screen shares: the page heading, and the sign-in
 * prompt in place of the screen while logged out (Penpot 01-回報可疑訊息-未登入).
 *
 * The /report routes sit OUTSIDE the `_ai` layout on purpose: `_ai` swaps its
 * whole outlet for `LoggedOutLanding` when there is no user and pins the page
 * to the viewport, and these pages need their own heading and "sign in to
 * report" copy in that state, and scroll the document like any other page. The
 * site nav comes from `__root`.
 */
export function ReportShell({
  errors = [],
  children,
}: {
  /**
   * The screen's query and mutation errors; the first one is shown under it.
   * AUTH_EXPIRED is skipped: the global QueryCache / MutationCache handler
   * opens the login modal for it.
   */
  errors?: Array<unknown>
  children: ReactNode
}) {
  const { user } = useAuth()
  const failure = errors.find((e) => e && !isAuthExpiredError(e))

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-spacing-24 px-spacing-20 py-spacing-32">
      <div className="flex flex-col gap-spacing-8 text-center">
        <h1 className="text-type-heading-l text-text-primary">
          幫忙攔下正在傳的假訊息
        </h1>
        <p className="text-type-body-m text-text-secondary">
          貼上訊息的網址 —— 有連結，大家才能確認它真的在流傳
        </p>
      </div>

      {user ? children : <LoginPrompt message="登入後即可開始回報" />}

      {user && !!failure && (
        <p
          role="alert"
          className="text-center text-type-body-s text-status-incorrect"
        >
          {failure instanceof Error ? failure.message : '送出失敗，請再試一次'}
        </p>
      )}
    </main>
  )
}
