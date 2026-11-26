import { expect, within } from 'storybook/test'

import { viewportOptions } from '../../.storybook/viewports'
import { ArticleStats } from './ArticleStats'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/ArticleStats',
  component: ArticleStats,
  parameters: {
    penpot: { component: 'Feedback/ReportStatus' },
    viewport: { options: viewportOptions },
  },
  decorators: [
    (Story) => (
      <div className="p-spacing-20">
        <Story />
      </div>
    ),
  ],
  args: { replyCount: 0, replyRequestCount: 23 },
} satisfies Meta<typeof ArticleStats>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Penpot `Device = Desktop`: each number over its label. The counts read label first: 「回應 0」
 * 「回報 23」.
 */
export const Desktop: Story = {
  parameters: { penpot: { variant: { Device: 'Desktop' } } },
  globals: { viewport: { value: 'penpotDesktop', isRotated: false } },
  decorators: [
    (Story) => (
      <div className="flex">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const terms = canvas.getAllByRole('term')
    await expect(terms.map((t) => t.textContent)).toEqual(['回應', '回報'])
    const counts = canvas.getAllByRole('definition')
    await expect(counts.map((d) => d.textContent)).toEqual(['0', '23'])
  },
}

/** Penpot `Device = Mobile`: label beside number, across the width it is given. */
export const Mobile: Story = {
  parameters: { penpot: { variant: { Device: 'Mobile' } } },
  globals: { viewport: { value: 'penpotMobile', isRotated: false } },
}

/**
 * Not in Penpot: counts in the thousands. Penpot's desktop columns are 46px wide, which fits two
 * digits; here they grow with the number, and labels don't wrap.
 */
export const LargeCounts: Story = {
  tags: ['not-in-penpot'],
  args: { replyCount: 128, replyRequestCount: 12345 },
}
