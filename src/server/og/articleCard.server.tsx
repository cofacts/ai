// /article/:id/og.png: the share-preview card of one article, drawn with satori
// (JSX → SVG) and resvg (SVG → PNG, as wasm).
//
// REMINDER (cofacts/ai#210): Penpot has no board for this card yet. The layout is a
// proposal for the designer, and so is what it shows: the message text, the
// fact-check result (ogVerdict's placeholder rule), and 「N 人回報此訊息」.

import satori from 'satori'

import type { OgReplyType } from '@/routes/article.$id/-lib'
import { replyTypeText } from '@/components/FactCheckReplyTitle'
import { LOGO_PATHS } from '@/components/logo-paths'
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '@/routes/article.$id/-lib'

// Design tokens (src/styles/tokens.css, light theme). satori takes plain values, not CSS variables.
const COLOR = {
  textPrimary: '#111827', // neutral-900
  textSecondary: '#374151', // neutral-700
  surfaceRaised: '#f3f4f6', // neutral-100
  border: '#e5e7eb', // neutral-200
  brand: '#ffc840', // brand-400
  status: {
    RUMOR: '#df3324', // red-700
    NOT_RUMOR: '#06865b', // green-700
    OPINIONATED: '#1673d1', // blue-600
    NOT_ARTICLE: '#7c45d6', // purple-600
  },
} satisfies Record<string, unknown>

export type ArticleCardProps = {
  /** The message text; null for BLOCKED, whose content must not be shown. */
  text: string | null
  articleType: string
  /** A JPEG data URL of the image message, or null. */
  imageDataUrl: string | null
  verdict: OgReplyType | null
  replyRequestCount: number
}

const MEDIA_LABEL: Record<string, string> = {
  VIDEO: '（影片訊息）',
  AUDIO: '（聲音訊息）',
  IMAGE: '（圖片訊息）',
}

function ArticleCard({
  text,
  articleType,
  imageDataUrl,
  verdict,
  replyRequestCount,
}: ArticleCardProps) {
  const message =
    text === null
      ? '這則訊息的內容不公開。'
      : text.replace(/\s+/g, ' ').trim() ||
        MEDIA_LABEL[articleType] ||
        '（這則訊息沒有文字內容）'
  const verdictLine = verdict
    ? {
        text: `Cofacts 查核：${replyTypeText[verdict]}`,
        color: COLOR.status[verdict],
      }
    : { text: '查核中：還沒有查核回應', color: COLOR.textSecondary }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        borderTop: `16px solid ${COLOR.brand}`,
        padding: '48px 64px',
        fontFamily: 'Noto Sans TC',
        color: COLOR.textPrimary,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <svg width={220} height={62} viewBox="0 0 110 31">
          {LOGO_PATHS.map(([isBrand, d], i) => (
            <path
              key={i}
              d={d}
              fill={isBrand ? COLOR.brand : COLOR.textPrimary}
            />
          ))}
        </svg>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: COLOR.textSecondary,
            background: COLOR.surfaceRaised,
            borderRadius: 8,
            padding: '6px 16px',
          }}
        >
          可疑訊息
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flex: 1,
          gap: 40,
          marginTop: 40,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'block',
            flex: 1,
            minWidth: 0,
            fontSize: 44,
            lineHeight: 1.5,
            lineClamp: 4,
            overflow: 'hidden',
          }}
        >
          {message}
        </div>
        {imageDataUrl && (
          <img
            src={imageDataUrl}
            width={300}
            height={300}
            style={{
              width: 300,
              height: 300,
              flexShrink: 0,
              objectFit: 'cover',
              borderRadius: 12,
              border: `2px solid ${COLOR.border}`,
            }}
          />
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 32,
          paddingTop: 24,
          borderTop: `2px solid ${COLOR.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            fontWeight: 700,
            color: verdictLine.color,
          }}
        >
          {verdictLine.text}
        </div>
        <div
          style={{ display: 'flex', fontSize: 28, color: COLOR.textSecondary }}
        >
          {`${replyRequestCount} 人回報此訊息`}
        </div>
      </div>
    </div>
  )
}

/** The card as a PNG. Loads the fonts and resvg on the first card. */
export async function renderArticleCard(props: ArticleCardProps) {
  const [{ ogFonts }, { svgToPng }] = await Promise.all([
    import('./fonts.server'),
    import('./resvg.server'),
  ])
  const svg = await satori(<ArticleCard {...props} />, {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: ogFonts,
  })
  return svgToPng(svg)
}
