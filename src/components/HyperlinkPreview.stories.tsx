import { expect, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { HyperlinkPreview } from './HyperlinkPreview'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/HyperlinkPreview',
  component: HyperlinkPreview,
  parameters: {
    penpot: { component: 'Content/LinkCard' },
    viewport: { options: viewportOptions },
  },
  decorators: [
    (Story) => (
      <div className="max-w-[860px]">
        <Story />
      </div>
    ),
  ],
  args: {
    hyperlink: {
      url: 'https://today.line.me/TW/article/v9qjD0?utm_source=lineshare',
      title: '憂心防疫前線人員口罩！88歲嬤「1行為」曝光　6百萬人全落淚',
      summary:
        '新冠肺炎疫情在全球延燒，其中歐洲的義大利、西班牙淪為疫情重災區，死亡人數皆已超過中國。而在西班牙的一位年邁長者，不捨國家內的前線防疫人員將面臨口罩不足的情況，決定親手縫製口罩送給醫護人員，她的舉動感動了六百萬名網友。',
    },
  },
} satisfies Meta<typeof HyperlinkPreview>

export default meta
type Story = StoryObj<typeof meta>

/** Penpot Content/LinkCard. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    // The whole card is one link, and it says it opens in a new tab.
    const link = within(canvasElement).getByRole('link')
    await expect(link).toHaveAttribute('href', args.hyperlink.url)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toHaveAccessibleName(/（另開新分頁）/)
  },
}

/** Not in Penpot: rumors-api found no title or summary, so only the URL is left. */
export const UrlOnly: Story = {
  args: {
    hyperlink: {
      url: 'https://www.kaineng.com.tw/knowledge-bedridden-care/?utm_source=line&utm_medium=share&utm_campaign=a-very-long-campaign-name',
    },
  },
}

const unsafeUrls = ['javascript:alert(1)', 'data:text/html,hi', 'not a url']

/** The url is user-submitted: one that is not http(s) shows as text, never as a link. */
export const UnsafeUrl: Story = {
  render: (args) => (
    <div className="flex flex-col gap-spacing-16">
      {unsafeUrls.map((url) => (
        <HyperlinkPreview
          key={url}
          {...args}
          hyperlink={{ url, title: 'Not a link' }}
        />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('link')).toBeNull()
    for (const url of unsafeUrls) {
      await expect(canvas.getByText(url)).toBeVisible()
    }
  },
}
