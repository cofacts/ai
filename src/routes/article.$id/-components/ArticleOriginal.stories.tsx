import { expect, fn, within } from 'storybook/test'

import { ArticleOriginal } from './ArticleOriginal'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

// A 1×1 PNG, so the stories don't depend on a signed rumors-api URL.
const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAwMB/0tP3VEAAAAASUVORK5CYII='

const meta = {
  title: 'article/ArticleOriginal',
  component: ArticleOriginal,
  tags: ['not-in-penpot'],
  parameters: {
    docs: {
      description: {
        component:
          "**Not audited against Penpot yet.** 原始訊息 on /article/:id (Penpot MessagePage-1440, MessagePage-原始訊息): the reported message, its attachment, and the login prompt for media a logged-out visitor cannot open. Built from rumors-site's behaviour; to be checked against the boards.",
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
    await expect(canvas.getByText(/12 人回報此訊息/)).toBeInTheDocument()
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
