import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EDITOR_FACEBOOK_GROUP, LICENSE_URL, TERMS_URL } from '@/lib/legal'

/** Longer display names are cut so the submit button stays on one line in the drawer. */
const MAX_NAME_LENGTH = 10

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-link underline"
    >
      {children}
    </a>
  )
}

/** The submit button's label, naming whose account the reply goes out under. */
export function submitButtonLabel(userName: string | null): string {
  if (!userName) return '用你的帳號送出查核回應'
  // Count code points, not UTF-16 units, so an emoji in a name isn't split in half.
  const chars = Array.from(userName)
  const name =
    chars.length > MAX_NAME_LENGTH
      ? `${chars.slice(0, MAX_NAME_LENGTH).join('')}…`
      : userName
  return `用 ${name} 的身份送出查核回應`
}

/**
 * The bottom of the draft drawer, where a fact-check reply is submitted to Cofacts. The reply
 * goes out publicly under the user's own account and is NOT labelled as AI-generated (on
 * purpose: the person who sends it owns it). Instead of a confirmation dialog, the check sits
 * right above the button, which names the account and stays disabled until the box is checked.
 * It repeats the license notice from LoginModal.
 *
 * The parent keeps `checked`, so it is not reset when the user edits the draft after checking.
 * Getting replies submitted is the point of Cofacts.ai, so the wording states the consequences
 * plainly without legal weight (no 「文責」).
 */
export function SubmitReplyFooter({
  userName,
  checked,
  onCheckedChange,
  problem,
  pending = false,
  error,
  onSubmit,
}: {
  /** The logged-in user's display name; null when it could not be loaded. */
  userName: string | null
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Why this draft cannot be submitted (no article, empty fields); null when it can. */
  problem: string | null
  pending?: boolean
  error?: string | null
  onSubmit: () => void
}) {
  const checkId = useId()

  return (
    <div className="shrink-0 border-t border-border-subtle bg-surface-base p-spacing-16 space-y-spacing-8">
      {problem ? (
        <p className="text-type-caption text-text-tertiary">{problem}</p>
      ) : (
        <>
          <label
            htmlFor={checkId}
            className="flex items-start gap-spacing-8 cursor-pointer text-type-body-s text-text-primary"
          >
            <Checkbox
              id={checkId}
              className="mt-[3px]"
              checked={checked}
              onCheckedChange={onCheckedChange}
              disabled={pending}
            />
            <span>我已經檢查過回應內文與出處</span>
          </label>
          <p className="text-type-caption text-text-secondary">
            送出後會以你的名字公開在 Cofacts，不會標示為 AI 產生。
          </p>
        </>
      )}

      {error && (
        <p role="alert" className="text-type-caption text-status-incorrect">
          送出失敗：{error}
        </p>
      )}

      <Button
        className="w-full"
        iconStart="send"
        disabled={!!problem || !checked || pending}
        aria-busy={pending || undefined}
        title={userName ?? undefined}
        onClick={onSubmit}
      >
        {pending ? '送出中…' : submitButtonLabel(userName)}
      </Button>

      <p className="text-type-caption text-text-tertiary">
        送出即代表您同意{' '}
        <ExternalLink href={TERMS_URL}>使用者條款</ExternalLink>
        ，並您的貢獻將以{' '}
        <ExternalLink href={LICENSE_URL}>
          創用 CC 姓名標示-相同方式分享 4.0
        </ExternalLink>
        ，由{' '}
        <ExternalLink href={EDITOR_FACEBOOK_GROUP}>
          Cofacts 真的假的訊息回報機器人與查證協作社群
        </ExternalLink>{' '}
        發布。
      </p>
    </div>
  )
}
