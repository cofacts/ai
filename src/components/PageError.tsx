import { useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'

/**
 * The router's default error component: shown in place of a page whose loader failed, inside
 * the site nav (the server responds 500). Penpot has no error screen yet.
 */
export function PageError({ reset }: Pick<ErrorComponentProps, 'reset'>) {
  const router = useRouter()
  return (
    <main className="mx-auto flex w-full max-w-[1136px] flex-1 flex-col items-start gap-spacing-16 px-spacing-20 py-spacing-32 lg:px-spacing-48">
      <h1 className="text-type-heading-l text-text-primary">頁面載入失敗</h1>
      <p className="text-type-body-m text-text-secondary">
        資料暫時無法取得，請稍後再試。
      </p>
      <Button
        onClick={() => {
          reset()
          void router.invalidate()
        }}
      >
        重新載入
      </Button>
    </main>
  )
}
