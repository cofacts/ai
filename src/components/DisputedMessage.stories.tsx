import { expect, userEvent, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { DisputedMessage } from './DisputedMessage'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-06T12:00:00+08:00')

/** Penpot's sample copy, plus two paragraphs so it is cut off at 375 and 1440. */
const longText =
  '這幾天會下雨，千萬不要被雨淋到，離雨水遠一點！ 今晚看氣象報告，這次下雨的雲層帶是從中國內陸漂過來的，也就是重慶、湖北一帶過來的，雲層可能會挾帶細菌、病毒過來，請小心心心心心心心心心心心心心心心心心心心心心心心心心心心心心心心心！\n\n轉傳給你關心的人，大家一起注意身體健康，出門記得帶傘，回家先洗手洗臉，避免接觸雨水。\n\n以上消息由氣象專家提供，請大家多多分享，讓更多親朋好友知道。下雨天記得關好門窗，衣服不要晾在外面，以免沾到雨水裡的細菌和病毒；小朋友和長輩的抵抗力比較弱，更要特別小心。'

const meta = {
  title: 'components/DisputedMessage',
  component: DisputedMessage,
  parameters: {
    layout: 'fullscreen',
    penpot: {
      component: 'Content/DisputedMessage',
      mobile: 'Content/DisputedMessage-Mobile',
    },
    viewport: { options: viewportOptions },
  },
  decorators: [
    (Story) => (
      // A page column on the list's grey background: 20px gutters on mobile (Penpot's 335 in
      // 375), 1040 max on desktop.
      <div className="min-h-screen bg-surface-raised p-spacing-20">
        <div className="mx-auto max-w-[1040px]">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    articleType: 'IMAGE',
    text: longText,
    thumbnailUrl: new URL('./__fixtures__/og-image.jpg', import.meta.url).href,
    replyCount: 0,
    replyRequestCount: 23,
    // Fixed, so 「1 天前」 doesn't change with the day the story is opened.
    createdAt: new Date(NOW - DAY - 60_000).toISOString(),
    now: new Date(NOW).toISOString(),
    href: '/article/AVqVwjqQyrCAoOCrjS5G',
  },
} satisfies Meta<typeof DisputedMessage>

export default meta
type Story = StoryObj<typeof meta>

// ── Penpot ──

/**
 * Penpot `State = default`: an image message. The whole card opens the message's page; the
 * 首次回報於 line is the link. 閱讀全文 opens the whole text instead.
 */
export const Default: Story = {
  parameters: { penpot: { variant: { State: 'default' } } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole('link', { name: '首次回報於 1 天前' })
    await expect(link).toHaveAttribute('href', args.href)
    // Every card starts with 首次回報於, so the message text says which one this is.
    // Accessible text collapses the line breaks into spaces.
    await expect(link).toHaveAccessibleDescription(
      args.text.replace(/\s+/g, ' '),
    )
    // The counts read label first: 「回應 0」「回報 23」.
    const terms = canvas.getAllByRole('term')
    await expect(terms.map((t) => t.textContent)).toEqual(['回應', '回報'])
    const counts = canvas.getAllByRole('definition')
    await expect(counts.map((d) => d.textContent)).toEqual(['0', '23'])
    // The text beside the image is its transcript, so the image is decorative.
    await expect(canvas.getByRole('presentation')).toHaveAttribute('alt', '')

    // 閱讀全文 is a button outside the link, drawn above the link's cover: a click expands the
    // text and doesn't open the page.
    const button = await canvas.findByRole('button', { name: '閱讀全文' })
    await expect(link).not.toContainElement(button)
    await userEvent.click(button)
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(button).toHaveAccessibleName('收合全文')

    // Keyboard: the link first, then 閱讀全文.
    await userEvent.click(canvasElement.ownerDocument.body)
    await userEvent.tab()
    await expect(link).toHaveFocus()
    await userEvent.tab()
    await expect(button).toHaveFocus()
  },
}

/**
 * Penpot `State = read`: a message the user has opened. In Penpot it looks the same as
 * `default` (same tokens, same layout), so it renders the same here, until the designer says
 * what should change. rumors-site greyed the card of a visited link.
 */
export const Read: Story = {
  parameters: { penpot: { variant: { State: 'read' } } },
}

/** Penpot's middle card on both boards: the image hidden, a text message. */
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
 * Not in Penpot: a video, with the placeholder ArticleCard uses. The text beside it is the AI
 * transcript rumors-api writes when the message comes in.
 */
export const Video: Story = {
  tags: ['not-in-penpot'],
  args: { articleType: 'VIDEO', thumbnailUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('影片')).toBeVisible()
    await expect(canvas.getByText('無法預覽')).toBeVisible()
  },
}

/**
 * Not in Penpot: a video without a transcript. A muted line says what the message is, and
 * describes the link in place of the text.
 */
export const VideoWithoutText: Story = {
  tags: ['not-in-penpot'],
  args: { articleType: 'VIDEO', thumbnailUrl: null, text: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link')).toHaveAccessibleDescription(
      '這則是影片訊息，點開查看原始影片',
    )
  },
}

/** Not in Penpot: an audio message. Its placeholder has no 無法預覽. */
export const Audio: Story = {
  tags: ['not-in-penpot'],
  args: { articleType: 'AUDIO' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('語音訊息')).toBeVisible()
    await expect(canvas.queryByText('無法預覽')).toBeNull()
  },
}

/** Not in Penpot: an image whose thumbnail fails to load gives way to the placeholder. */
export const BrokenThumbnail: Story = {
  tags: ['not-in-penpot'],
  args: { thumbnailUrl: '/__missing__/thumbnail.jpg' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('無法預覽')).toBeVisible()
    await expect(canvas.queryByRole('presentation')).toBeNull()
  },
}

/** Not in Penpot: a text that fits needs no 閱讀全文, so the link is the card's only stop. */
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

/**
 * Not in Penpot: counts in the thousands. Penpot's columns are 46px wide, which fits two
 * digits; here they grow with the number.
 */
export const LargeCounts: Story = {
  tags: ['not-in-penpot'],
  args: { replyCount: 128, replyRequestCount: 12345 },
}

/** Not in Penpot: reported more than two days ago reads as a date, as in Penpot's sample. */
export const OlderThanTwoDays: Story = {
  tags: ['not-in-penpot'],
  args: { createdAt: new Date(NOW - 10 * DAY).toISOString() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link')).toHaveAccessibleName(
      '首次回報於 10月27日',
    )
  },
}
