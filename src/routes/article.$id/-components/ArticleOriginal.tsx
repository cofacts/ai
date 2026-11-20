import { formatReportedDate, linkifyText } from '../-lib'
import type { Hyperlink } from '@/components/HyperlinkPreview'
import type { ArticleTypeEnum } from '@/server/gql/graphql'

import { HyperlinkPreview } from '@/components/HyperlinkPreview'
import { Button } from '@/components/ui/button'

export type ArticleOriginalProps = {
  text: string | null | undefined
  articleType: ArticleTypeEnum
  /** Downsized image (PREVIEW); null for other types. */
  attachmentUrl?: string | null
  /** The original file. rumors-api gives it to logged-in website users only. */
  originalAttachmentUrl?: string | null
  /** rumors-api's previews of the URLs in a text message. */
  hyperlinks?: ReadonlyArray<Hyperlink> | null
  replyRequestCount?: number | null
  createdAt?: string | null
  /** Opens the login dialog; shown where a logged-out visitor can't see the file. */
  onLogin: () => void
}

/**
 * 原始訊息: the message as it was reported (rumors-site's article card). A text
 * message shows its text with links, and a preview card of each link (Penpot
 * Content/LinkCard); an image shows the preview, linked to the
 * original for logged-in users; a video or audio plays the original, which only
 * logged-in users get. The transcript of a media message is the Transcript's job
 * (#184 PR 9), as on rumors-site.
 */
export function ArticleOriginal({
  text,
  articleType,
  attachmentUrl,
  originalAttachmentUrl,
  hyperlinks,
  replyRequestCount,
  createdAt,
  onLogin,
}: ArticleOriginalProps) {
  const reportedDate = formatReportedDate(createdAt)

  return (
    <div className="flex flex-col gap-spacing-16">
      <p className="text-type-body-s text-text-secondary">
        {replyRequestCount ?? 0} 人回報此訊息
        {reportedDate && (
          <>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">，</span>
            首次回報於{' '}
            <time dateTime={createdAt ?? undefined}>{reportedDate}</time>
          </>
        )}
      </p>

      <ArticleBody
        text={text}
        articleType={articleType}
        attachmentUrl={attachmentUrl}
        originalAttachmentUrl={originalAttachmentUrl}
        hyperlinks={hyperlinks}
        onLogin={onLogin}
      />
    </div>
  )
}

function ArticleBody({
  text,
  articleType,
  attachmentUrl,
  originalAttachmentUrl,
  hyperlinks,
  onLogin,
}: Pick<
  ArticleOriginalProps,
  | 'text'
  | 'articleType'
  | 'attachmentUrl'
  | 'originalAttachmentUrl'
  | 'hyperlinks'
  | 'onLogin'
>) {
  switch (articleType) {
    case 'IMAGE': {
      if (!attachmentUrl) return <EmptyNote>圖片無法顯示。</EmptyNote>
      const image = (
        <img
          src={attachmentUrl}
          alt="訊息中的圖片"
          className="max-h-[480px] max-w-full rounded-radius-5 border border-border-subtle object-contain"
        />
      )
      return originalAttachmentUrl ? (
        <a
          href={originalAttachmentUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="開啟原始圖片（另開新視窗）"
          className="self-start"
        >
          {image}
        </a>
      ) : (
        image
      )
    }
    case 'VIDEO':
      return originalAttachmentUrl ? (
        <video
          src={originalAttachmentUrl}
          controls
          preload="metadata"
          aria-label="訊息中的影片"
          className="max-h-[480px] max-w-full rounded-radius-5"
        />
      ) : (
        <LoginNotice onLogin={onLogin}>登入後查看影片內容</LoginNotice>
      )
    case 'AUDIO':
      return originalAttachmentUrl ? (
        <audio
          src={originalAttachmentUrl}
          controls
          preload="metadata"
          aria-label="訊息中的聲音"
          className="w-full max-w-[480px]"
        />
      ) : (
        <LoginNotice onLogin={onLogin}>登入後查看聲音內容</LoginNotice>
      )
    default:
      if (!text) return <EmptyNote>這則訊息沒有文字內容。</EmptyNote>
      return (
        <>
          <p className="text-type-body-m whitespace-pre-wrap wrap-anywhere text-text-primary">
            {linkifyText(text).map((segment, index) =>
              segment.type === 'link' ? (
                <a
                  key={index}
                  href={segment.href}
                  target="_blank"
                  // Links in a reported message are user content, not endorsements.
                  rel="ugc nofollow noopener noreferrer"
                  className="text-text-link underline"
                >
                  {segment.text}
                </a>
              ) : (
                segment.text
              ),
            )}
          </p>
          {/* Only a text message has hyperlinks, as on rumors-site. */}
          {hyperlinks && hyperlinks.length > 0 && (
            <ul className="flex flex-col gap-spacing-12">
              {hyperlinks.map((hyperlink, index) => (
                <li key={`${index}-${hyperlink.url}`}>
                  <HyperlinkPreview hyperlink={hyperlink} rel="ugc nofollow" />
                </li>
              ))}
            </ul>
          )}
        </>
      )
  }
}

function EmptyNote({ children }: { children: string }) {
  return <p className="text-type-body-m text-text-secondary">{children}</p>
}

function LoginNotice({
  children,
  onLogin,
}: {
  children: string
  onLogin: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-spacing-12 rounded-radius-5 border border-border-subtle bg-surface-raised p-spacing-16">
      <p className="text-type-body-m text-text-primary">{children}</p>
      <Button variant="outline" size="md" onClick={onLogin}>
        登入
      </Button>
    </div>
  )
}
