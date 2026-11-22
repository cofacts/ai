import { expect, waitFor } from 'storybook/test'

import { Tabs, TabsList, TabsPanel, TabsTab } from './tabs'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const meta = {
  title: 'ui/Tabs',
  component: Tabs,
  tags: ['not-in-penpot'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '**Not in Penpot.** Base UI Tabs with Cofacts tokens: equal tabs over a 1px rule, the selected one with a brand-yellow underline and bold text. The app uses it to split the reasons of ReplyFeedback into 有幫助 and 沒幫助, as rumors-site does. Penpot has `Content/EditorTab`, which is a different control. To discuss with the designer: keep it as is, or add it to Penpot.',
      },
    },
  },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

/** Arrow keys move and select, as `activateOnFocus` is on. */
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="up" className="max-w-[420px]">
      <TabsList>
        <TabsTab value="up">有幫助 3</TabsTab>
        <TabsTab value="down">沒幫助 1</TabsTab>
      </TabsList>
      <TabsPanel value="up">三個人覺得有幫助。</TabsPanel>
      <TabsPanel value="down">一個人覺得沒幫助。</TabsPanel>
    </Tabs>
  ),
  play: async ({ canvas, userEvent }) => {
    const up = canvas.getByRole('tab', { name: '有幫助 3' })
    await expect(up).toHaveAttribute('aria-selected', 'true')
    up.focus()
    await userEvent.keyboard('{ArrowRight}')
    const down = canvas.getByRole('tab', { name: '沒幫助 1' })
    await expect(down).toHaveAttribute('aria-selected', 'true')
    // The old panel stays mounted (inert) while its exit transition runs.
    await waitFor(() =>
      expect(canvas.getByRole('tabpanel')).toHaveTextContent(
        '一個人覺得沒幫助。',
      ),
    )
  },
}
