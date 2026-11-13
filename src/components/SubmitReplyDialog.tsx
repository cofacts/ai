import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EDITOR_FACEBOOK_GROUP, LICENSE_URL, TERMS_URL } from '@/lib/legal'

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

/**
 * Confirms submitting a fact-check reply to Cofacts. The reply goes out publicly under the
 * user's own account and is NOT labelled as AI-generated (on purpose: the person who sends it
 * owns it), so they confirm both checks before 「確定送出」 is enabled; 取消 (or Esc) backs out
 * without sending. It repeats the license notice from LoginModal.
 *
 * Getting replies submitted is the point of Cofacts.ai, so the wording states the consequences
 * plainly without legal weight (no 「文責」). While sending, the dialog cannot be dismissed.
 */
export function SubmitReplyDialog({
  open,
  onOpenChange,
  userName,
  pending = false,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The logged-in user's display name; null when it could not be loaded. */
  userName: string | null
  pending?: boolean
  error?: string | null
  onConfirm: () => void
}) {
  const [checkedContent, setCheckedContent] = useState(false)
  const [checkedIdentity, setCheckedIdentity] = useState(false)
  const contentId = useId()
  const identityId = useId()

  const handleOpenChange = (next: boolean) => {
    if (pending) return
    // Ask again every time the dialog opens.
    if (!next) {
      setCheckedContent(false)
      setCheckedIdentity(false)
    }
    onOpenChange(next)
  }

  const identity = userName ? `「${userName}」` : '我目前登入的 Cofacts 帳號'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>送出查核回應</DialogTitle>
          <DialogDescription>
            送出後，這則查核回應會以你的名字公開在 Cofacts，不會標示為 AI 產生。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-spacing-12 text-type-body-s text-text-primary">
          <label
            htmlFor={contentId}
            className="flex items-start gap-spacing-8 cursor-pointer"
          >
            <Checkbox
              id={contentId}
              className="mt-[3px]"
              checked={checkedContent}
              onCheckedChange={setCheckedContent}
              disabled={pending}
            />
            <span>我已經檢查過回應內文與出處</span>
          </label>
          <label
            htmlFor={identityId}
            className="flex items-start gap-spacing-8 cursor-pointer"
          >
            <Checkbox
              id={identityId}
              className="mt-[3px]"
              checked={checkedIdentity}
              onCheckedChange={setCheckedIdentity}
              disabled={pending}
            />
            <span>我願意用{identity}的身份送出這個查核回應</span>
          </label>
        </div>

        <p className="text-type-caption text-text-secondary">
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

        {error && (
          <p role="alert" className="text-type-caption text-status-incorrect">
            送出失敗：{error}
          </p>
        )}

        <div className="flex justify-end gap-spacing-8">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            取消
          </Button>
          <Button
            iconStart="send"
            disabled={!checkedContent || !checkedIdentity || pending}
            aria-busy={pending || undefined}
            onClick={onConfirm}
          >
            {pending ? '送出中…' : '確定送出'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
