import { expect, userEvent, waitFor, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { ArticleCard } from './ArticleCard'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-06T12:00:00+08:00')

/** Penpot's sample copy. */
const longText =
  '這幾天會下雨，千萬不要被雨淋到，離雨水遠一點！ 今晚看氣象報告，這次下雨的雲層帶是從中國內陸漂過來的，也就是重慶、湖北一帶過來的，雲層可能會挾帶細菌、病毒過來，請小心心心心心心心心心心心心心心心心心心心心心心心心心心心心心心心心！\n\n轉傳給你關心的人，大家一起注意身體健康，出門記得帶傘，回家先洗手洗臉，避免接觸雨水。'

const meta = {
  title: 'components/ArticleCard',
  component: ArticleCard,
  parameters: {
    layout: 'fullscreen',
    penpot: {
      component: 'Content/FactCheckCard',
      mobile: 'Content/FactCheckCard-Original-Mobile',
    },
    viewport: { options: viewportOptions },
  },
  decorators: [
    (Story) => (
      // A page column: 16px gutters on mobile (Penpot's 343 in 375), 1040 max on desktop.
      <div className="mx-auto max-w-[1072px] p-spacing-16">
        <Story />
      </div>
    ),
  ],
  args: {
    articleType: 'IMAGE',
    text: longText,
    thumbnailUrl: new URL('./__fixtures__/og-image.jpg', import.meta.url).href,
    replyRequestCount: 6,
    // Fixed, so 「1 天前」 doesn't change with the day the story is opened.
    createdAt: new Date(NOW - DAY - 60_000).toISOString(),
    now: new Date(NOW).toISOString(),
    href: '/article/AVqVwjqQyrCAoOCrjS5G',
  },
} satisfies Meta<typeof ArticleCard>

export default meta
type Story = StoryObj<typeof meta>

// ── Penpot ──

/**
 * Penpot's card: an image message. Click 閱讀全文 to open the whole text; the button becomes
 * 收合全文. 查核闢謠 is a link to the message's page.
 */
export const Image: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('link', { name: '查核闢謠' }),
    ).toHaveAttribute('href', args.href)
    await expect(canvas.getByText(/被回報 6 次/)).toHaveTextContent(
      '被回報 6 次｜最初回報於 1 天前',
    )
    // The text beside the image is its transcript, so the image is decorative.
    await expect(canvas.getByRole('presentation')).toHaveAttribute('alt', '')

    // The button shows once the text is measured as cut off.
    const button = await canvas.findByRole('button', { name: '閱讀全文' })
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(button).toHaveAccessibleName('收合全文')
    await userEvent.click(button)
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: '閱讀全文' })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    )
  },
}

/** Penpot's mobile card without the image: a text message. */
export const Text: Story = {
  args: { articleType: 'TEXT', thumbnailUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img')).toBeNull()
    await expect(canvas.queryByRole('presentation')).toBeNull()
  },
}

// ── Not in Penpot ──

/**
 * Not in Penpot: a video. There is no thumbnail for video yet, so a placeholder with
 * rumors-site's wording takes the image's place.
 */
export const Video: Story = {
  tags: ['not-in-penpot'],
  args: { articleType: 'VIDEO', thumbnailUrl: null, text: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('影片')).toBeVisible()
    await expect(canvas.getByText('尚未支援預覽')).toBeVisible()
  },
}

/** Not in Penpot: an audio message with a transcript. Same placeholder as video. */
export const Audio: Story = {
  tags: ['not-in-penpot'],
  args: { articleType: 'AUDIO', thumbnailUrl: null },
}

/** Not in Penpot: an image message with no text names the image itself. */
export const ImageWithoutText: Story = {
  tags: ['not-in-penpot'],
  args: { text: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img')).toHaveAccessibleName('圖片訊息')
  },
}

/** Not in Penpot: a text that fits needs no 閱讀全文. */
export const ShortText: Story = {
  tags: ['not-in-penpot'],
  args: {
    articleType: 'TEXT',
    thumbnailUrl: null,
    text: '這幾天會下雨，千萬不要被雨淋到！',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(/千萬不要被雨淋到/)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await expect(
      canvas.queryByRole('button', { name: /閱讀全文|收合全文/ }),
    ).toBeNull()
  },
}

/** Not in Penpot: reported more than two days ago reads as a date. */
export const OlderThanTwoDays: Story = {
  tags: ['not-in-penpot'],
  args: { createdAt: new Date(NOW - 10 * DAY).toISOString() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/被回報 6 次/)).toHaveTextContent(
      '被回報 6 次｜最初回報於 10月27日',
    )
  },
}
