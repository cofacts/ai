import { useState } from 'react'

import type { ArticleTypeEnum } from '@/server/gql/graphql'
import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

/**
 * The placeholder for a message without a thumbnail. 無法預覽 is only for an image or video that
 * should have one. Audio never has one, and its transcript sits beside it, so a second line would
 * read as if something went wrong.
 */
const MEDIA_PLACEHOLDER: Partial<
  Record<
    ArticleTypeEnum,
    { icon: MaterialSymbol; label: string; unavailable: boolean }
  >
> = {
  IMAGE: { icon: 'image', label: '圖片', unavailable: true },
  VIDEO: { icon: 'videocam', label: '影片', unavailable: true },
  AUDIO: { icon: 'graphic_eq', label: '語音訊息', unavailable: false },
}

/**
 * Types that show `thumbnailUrl`, with the image's name. A video's thumbnail is a JPEG frame
 * (cofacts/kb `video-audio-thumbnail-preview.md`), cropped the same way.
 */
const THUMBNAIL_NAME: Partial<Record<ArticleTypeEnum, string>> = {
  IMAGE: '圖片訊息',
  VIDEO: '影片訊息',
}

/**
 * The thumbnail a message card can show, or null: none for its type, none given, or the given
 * one failed to load. Pass `onThumbnailError` to `ArticleMedia`.
 */
export function useArticleThumbnail(
  articleType: ArticleTypeEnum,
  thumbnailUrl: string | null | undefined,
) {
  // The URL that failed to load, so a new URL gets its own try. rumors-api hands out a
  // thumbnail URL without checking the file exists, and a broken attachment never gets one
  // (cofacts/kb video-audio-thumbnail-preview.md).
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const shownThumbnail =
    articleType in THUMBNAIL_NAME && thumbnailUrl && thumbnailUrl !== failedUrl
      ? thumbnailUrl
      : null
  return { shownThumbnail, onThumbnailError: setFailedUrl }
}

/**
 * For media, `text` is the AI transcript rumors-api writes when the message comes in. When there
 * is none (transcription failed or hasn't finished), a muted line says what the message is, so
 * the space beside the placeholder isn't empty. Null when there is text or nothing to say.
 */
export function mediaFallbackText(
  articleType: ArticleTypeEnum,
  text: string,
  shownThumbnail: string | null,
) {
  if (text) return null
  if (articleType === 'VIDEO') return '這則是影片訊息，點開查看原始影片'
  if (articleType === 'IMAGE' && !shownThumbnail) return '圖片暫時無法顯示'
  return null
}

export type ArticleMediaProps = {
  articleType: ArticleTypeEnum
  /** The message text; an image without it gets a name. */
  text: string
  /** The thumbnail to show: `shownThumbnail` from `useArticleThumbnail`. */
  thumbnailUrl: string | null
  onThumbnailError: (url: string) => void
}

/**
 * Penpot's 120×120 image beside a message's text, in ArticleCard and DisputedMessage: the
 * thumbnail, or a placeholder for media without one. TEXT messages have none.
 */
export function ArticleMedia({
  articleType,
  text,
  thumbnailUrl,
  onThumbnailError,
}: ArticleMediaProps) {
  const thumbnailName = THUMBNAIL_NAME[articleType]
  if (thumbnailName && thumbnailUrl) {
    const isVideo = articleType === 'VIDEO'
    return (
      <div className="relative size-[120px] shrink-0">
        <img
          src={thumbnailUrl}
          // An image rendered on the server can fail before React hydrates and attaches onError,
          // so the ref checks for an image that already finished without any pixels.
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0)
              onThumbnailError(thumbnailUrl)
          }}
          onError={() => onThumbnailError(thumbnailUrl)}
          // An image's text is its transcript, so the image only needs a name when there is no
          // text. A video's still frame doesn't show it's a video and its transcript doesn't
          // say so either, so it is always named.
          alt={isVideo || !text ? thumbnailName : ''}
          loading="lazy"
          className="size-full rounded-radius-5 object-cover"
        />
        {isVideo && (
          // The frame alone doesn't say it's a video. A corner mark, not a play button: the list
          // can't play it. rumors-api has no duration yet, so it's the icon only.
          <span className="absolute right-spacing-4 bottom-spacing-4 flex rounded-radius-2 bg-overlay-scrim p-spacing-2 text-icon-on-dark">
            <MaterialIcon name="videocam" size={16} />
          </span>
        )}
      </div>
    )
  }

  const placeholder = MEDIA_PLACEHOLDER[articleType]
  if (!placeholder) return null
  return (
    <div className="flex size-[120px] shrink-0 flex-col items-center justify-center gap-spacing-4 rounded-radius-5 bg-surface-raised p-spacing-8 text-center">
      <MaterialIcon name={placeholder.icon} className="text-icon-muted" />
      <p className="text-type-ui-s-bold text-text-primary">
        {placeholder.label}
      </p>
      {placeholder.unavailable && (
        <p className="text-type-caption text-text-secondary">無法預覽</p>
      )}
    </div>
  )
}
