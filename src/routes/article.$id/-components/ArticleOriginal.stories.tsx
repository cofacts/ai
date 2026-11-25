import { expect, fn, within } from 'storybook/test'

import { ArticleOriginal } from './ArticleOriginal'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

// A 1×1 PNG, so the stories don't depend on a signed rumors-api URL.
const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAwMB/0tP3VEAAAAASUVORK5CYII='

const HYPERLINKS = [
  {
    url: 'https://example.com/news?id=1',
    title: '衛福部：喝溫開水無法預防新冠肺炎',
    summary:
      '網傳「喝溫開水可以預防新冠肺炎」的訊息並非衛福部公告，請民眾勿轉傳。',
    topImageUrl: null,
  },
]

const meta = {
  title: 'article/ArticleOriginal',
  component: ArticleOriginal,
  parameters: {
    penpot: { board: 'MessagePage-1440 / MessagePage-原始訊息' },
    docs: {
      description: {
        component:
          '原始訊息 on /article/:id (Penpot MessagePage-1440, MessagePage-原始訊息): the Base/Flag with the report count, 首次回報 (right of the Flag on desktop, under it on mobile), the reported message and its attachment. Not in Penpot: the login prompt for the video or audio a logged-out visitor cannot open.',
      },
    },
  },
  args: {
    text: '衛福部公告：明天起喝溫開水可以預防新冠肺炎，詳見 https://example.com/news?id=1。請轉發給家人！',
    articleType: 'TEXT',
    replyRequestCount: 12,
    createdAt: '2026-11-16T17:30:00Z',
    onLogin: fn(),
  },
} satisfies Meta<typeof ArticleOriginal>

export default meta
type Story = StoryObj<typeof meta>

/** A text message: its URLs are links, marked as user content. */
export const Text: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('有 12 人想知道以下訊息的真實性'),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/^首次回報於/)).toBeInTheDocument()
    const link = canvas.getByRole('link', {
      name: 'https://example.com/news?id=1',
    })
    await expect(link).toHaveAttribute(
      'rel',
      'ugc nofollow noopener noreferrer',
    )
    await expect(link).toHaveAttribute('target', '_blank')
  },
}

/**
 * rumors-api resolved the message's URL: a Content/LinkCard under the text.
 * The card is user content too, so its link is `ugc nofollow`.
 */
export const TextWithHyperlink: Story = {
  args: {
    hyperlinks: HYPERLINKS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('link', {
      name: /衛福部：喝溫開水無法預防新冠肺炎/,
    })
    await expect(card).toHaveAttribute(
      'rel',
      'noopener noreferrer ugc nofollow',
    )
    await expect(card).toHaveAttribute('target', '_blank')
  },
}

/** A media message shows no preview cards, as on rumors-site. */
export const ImageWithHyperlink: Story = {
  args: {
    articleType: 'IMAGE',
    attachmentUrl: IMAGE,
    hyperlinks: HYPERLINKS,
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByText('衛福部：喝溫開水無法預防新冠肺炎'),
    ).not.toBeInTheDocument()
  },
}

export const EmptyText: Story = {
  args: { text: '' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('這則訊息沒有文字內容。'),
    ).toBeInTheDocument()
  },
}

/** Logged in: the preview links to the original image. */
export const Image: Story = {
  args: {
    articleType: 'IMAGE',
    attachmentUrl: IMAGE,
    originalAttachmentUrl: IMAGE,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('link', { name: '開啟原始圖片（另開新視窗）' }),
    ).toHaveAttribute('href', IMAGE)
  },
}

/** Logged out: the preview only, with no link. */
export const ImageLoggedOut: Story = {
  args: { articleType: 'IMAGE', attachmentUrl: IMAGE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('img', { name: '訊息中的圖片' }),
    ).toBeVisible()
    await expect(canvas.queryByRole('link')).toBeNull()
  },
}

/** Logged out: rumors-api gives no video file, so the visitor is asked to log in. */
export const VideoLoggedOut: Story = {
  args: { articleType: 'VIDEO' },
  play: async ({ canvasElement, args, userEvent }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('登入後查看影片內容')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: '登入' }))
    await expect(args.onLogin).toHaveBeenCalled()
  },
}

export const AudioLoggedOut: Story = {
  args: { articleType: 'AUDIO' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('登入後查看聲音內容'),
    ).toBeInTheDocument()
  },
}
