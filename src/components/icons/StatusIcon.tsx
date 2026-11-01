import { cn } from '@/lib/utils'

export const replyTypes = [
  'RUMOR',
  'NOT_RUMOR',
  'OPINIONATED',
  'NOT_ARTICLE',
] as const

export type ReplyType = (typeof replyTypes)[number]

/**
 * The four fact-check result shapes from Penpot Content/FactCheckReply-Title (a11y guide 03):
 * octagon ✕ (含有不實訊息), circle ✓ (含有正確訊息), square ⋯ (含有個人意見),
 * triangle ! (不在查證範圍). Shape + color, so color-blind readers can tell them apart.
 * Decorative: the label text next to it carries the meaning.
 */
export function StatusIcon({
  type,
  className,
}: {
  type: ReplyType
  className?: string
}) {
  const common = {
    'aria-hidden': true,
    focusable: false,
    className: cn('size-[28px] shrink-0 md:size-[38px]', className),
  } as const

  switch (type) {
    case 'RUMOR':
      return (
        <svg viewBox="0 0 38.55 38.55" {...common}>
          <path
            className="fill-current text-status-incorrect"
            d="M26.39 0L12.15 0C11.6 0 11.07 0.22 10.67 0.61L0.61 10.68C0.22 11.07 0 11.6 0 12.15L0 26.4C0 26.95 0.22 27.48 0.61 27.87L10.68 37.94C11.07 38.33 11.6 38.55 12.16 38.55L26.39 38.55C26.95 38.55 27.48 38.32 27.87 37.94L37.94 27.87C38.33 27.48 38.55 26.95 38.55 26.39L38.55 12.15C38.55 11.6 38.32 11.07 37.94 10.68L27.86 0.61C27.47 0.22 26.94 0 26.39 0Z"
          />
          <path
            className="fill-current text-text-on-status"
            d="M22.42 19.27L29.39 12.3C30.2 11.49 30.2 10.16 29.39 9.35C28.58 8.54 27.25 8.54 26.44 9.35L19.47 16.32L12.5 9.35C11.68 8.54 10.36 8.54 9.55 9.35C8.74 10.16 8.74 11.49 9.55 12.3L16.52 19.27L9.55 26.25C8.74 27.06 8.74 28.39 9.55 29.2C9.96 29.61 10.49 29.81 11.03 29.81C11.56 29.81 12.09 29.6 12.5 29.2L19.47 22.23L26.44 29.2C26.85 29.61 27.39 29.81 27.92 29.81C28.46 29.81 28.99 29.6 29.4 29.2C30.21 28.39 30.21 27.06 29.4 26.25L22.42 19.27Z"
          />
        </svg>
      )
    case 'NOT_RUMOR':
      return (
        <svg viewBox="0 0 38 38" {...common}>
          <circle
            className="fill-current text-status-correct"
            cx="19"
            cy="19"
            r="19"
          />
          <path
            className="stroke-current text-text-on-status"
            d="M28.5 14.25L15.44 26.13L9.5 20.73"
            fill="none"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'OPINIONATED':
      return (
        <svg viewBox="0 0 38 38" {...common}>
          <rect
            className="fill-current text-status-opinion"
            width="38"
            height="38"
            rx="4.33"
          />
          {[12.17, 19.17, 26.17].map((cx) => (
            <circle
              key={cx}
              className="fill-current text-text-on-status"
              cx={cx}
              cy="19.17"
              r="2.17"
            />
          ))}
        </svg>
      )
    case 'NOT_ARTICLE':
      return (
        <svg viewBox="0 -0.6 37 32.6" {...common}>
          <path
            className="fill-current text-status-outofscope"
            d="M15.29 1.8L0.5 26.61C-0.92 29.01 0.86 32 3.71 32L33.29 32C36.14 32 37.93 29.01 36.5 26.61L21.71 1.8C20.29 -0.6 16.72 -0.6 15.29 1.8Z"
          />
          <path
            className="fill-current text-text-on-status"
            d="M18.5 21.51C17.48 21.51 16.65 20.7 16.65 19.71L16.65 10.15C16.65 9.16 17.48 8.35 18.5 8.35C19.53 8.35 20.36 9.16 20.36 10.15L20.36 19.71C20.36 20.7 19.53 21.51 18.5 21.51ZM18.5 28.96C17.48 28.96 16.65 28.16 16.65 27.17L16.65 26.57C16.65 25.58 17.48 24.78 18.5 24.78C19.53 24.78 20.36 25.58 20.36 26.57L20.36 27.17C20.36 28.16 19.53 28.96 18.5 28.96Z"
          />
        </svg>
      )
  }
}
