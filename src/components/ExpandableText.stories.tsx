import { expect, userEvent, within } from 'storybook/test'

import { ExpandableText } from './ExpandableText'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'components/ExpandableText',
  component: ExpandableText,
  tags: ['not-in-penpot'],
  parameters: {
    docs: {
      description: {
        component:
          'Not a Penpot component of its own: the 閱讀全文 text inside Penpot Content/FactCheckReply and Content/FactCheckCard. Used by FactCheckReply and ArticleCard, each with the line clamp of its Penpot text box.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-[480px] p-spacing-16">
        <Story />
      </div>
    ),
  ],
  args: {
    clampClassName: 'line-clamp-3',
    children:
      '這幾天會下雨，千萬不要被雨淋到，離雨水遠一點！ 今晚看氣象報告，這次下雨的雲層帶是從中國內陸漂過來的，也就是重慶、湖北一帶過來的，雲層可能會挾帶細菌、病毒過來，請小心！轉傳給你關心的人，大家一起注意身體健康，出門記得帶傘。',
  },
} satisfies Meta<typeof ExpandableText>

export default meta
type Story = StoryObj<typeof meta>

/** Cut off at three lines; 閱讀全文 opens the rest and becomes 收合全文. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = await canvas.findByRole('button', { name: '閱讀全文' })
    await userEvent.click(button)
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(button).toHaveAccessibleName('收合全文')
  },
}
