import { expect, fn, within } from 'storybook/test'

import { ArticleMedia } from './ArticleMedia'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const thumbnailUrl = new URL('./__fixtures__/og-image.jpg', import.meta.url)
  .href

const meta = {
  title: 'components/ArticleMedia',
  component: ArticleMedia,
  tags: ['not-in-penpot'],
  parameters: {
    docs: {
      description: {
        component:
          'Not a Penpot component of its own: the 120×120 image beside the text in Penpot Content/FactCheckCard and Content/DisputedMessage. Used by ArticleCard and DisputedMessage. The placeholders for media without a thumbnail follow the designer’s feedback on ArticleCard and are not in Penpot.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="p-spacing-16">
        <Story />
      </div>
    ),
  ],
  args: {
    articleType: 'IMAGE',
    text: '這幾天會下雨，千萬不要被雨淋到！',
    thumbnailUrl,
    onThumbnailError: fn(),
  },
} satisfies Meta<typeof ArticleMedia>

export default meta
type Story = StoryObj<typeof meta>

/** An image with text beside it: the text is its transcript, so the image is decorative. */
export const Image: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('presentation')).toHaveAttribute('alt', '')
  },
}

/** An image without text gets a name. */
export const ImageWithoutText: Story = {
  args: { text: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: '圖片訊息' })).toBeVisible()
  },
}

/** A video's frame, always named, with a corner mark. */
export const VideoThumbnail: Story = {
  args: { articleType: 'VIDEO' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: '影片訊息' })).toBeVisible()
  },
}

/** An image without a thumbnail, or whose thumbnail failed. */
export const ImagePlaceholder: Story = {
  args: { thumbnailUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('圖片')).toBeVisible()
    await expect(canvas.getByText('無法預覽')).toBeVisible()
  },
}

/** A video without a thumbnail. */
export const VideoPlaceholder: Story = {
  args: { articleType: 'VIDEO', thumbnailUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('影片')).toBeVisible()
    await expect(canvas.getByText('無法預覽')).toBeVisible()
  },
}

/** Audio never has a thumbnail, so its placeholder has no 無法預覽. */
export const AudioPlaceholder: Story = {
  args: { articleType: 'AUDIO', thumbnailUrl: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('語音訊息')).toBeVisible()
    await expect(canvas.queryByText('無法預覽')).toBeNull()
  },
}

/** A text message has no image. */
export const Text: Story = {
  args: { articleType: 'TEXT', thumbnailUrl: null },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img, p')).toBeNull()
  },
}
