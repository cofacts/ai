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

/**
 * Confirms submitting a fact-check reply to Cofacts. The reply goes out publicly under the
 * user's own account, so they confirm both checks before 「確定送出」 is enabled; 取消 (or Esc)
 * backs out without sending. While sending, the dialog stays open and cannot be dismissed.
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
            送出後，這則查核回應會公開在 Cofacts，並顯示為你的回應。
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
