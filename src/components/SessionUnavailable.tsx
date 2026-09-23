import { Link } from '@tanstack/react-router'

// Shown in place of the chat area when the session in the URL returns 404
// from ADK — most commonly a tab left on `/session/:sessionId` across an
// account switch, where the id belongs to the previous user. There is
// nothing to render or retry: the session itself is gone for this account.
export function SessionUnavailable() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
      <p className="text-text-main font-medium">此對話目前的帳號無法使用</p>
      <p className="text-sm text-text-muted max-w-md">
        這個對話可能不屬於目前登入的帳號，或已經不存在了。
      </p>
      <Link
        to="/"
        className="mt-2 px-4 py-1.5 rounded-full bg-primary text-white text-sm font-medium hover:bg-primary/90"
      >
        回首頁
      </Link>
    </div>
  )
}
