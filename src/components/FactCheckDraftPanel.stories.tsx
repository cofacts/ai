import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FactCheckDraftPanel } from './FactCheckDraftPanel'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

const args = {
  classification: 'OPINIONATED',
  text: '這則訊息結合了已發生的食安爭議、媒體調查報導，以及對宗教團體政治立場的個人觀點與擔憂。\n\n1. 關於石虎米農藥爭議：2023 年初，石虎米品牌商確實因檢驗出農藥殘留，與契作農友產生拒收爭議。',
  references:
    'https://www.cna.com.tw/news/aopl/202506200337.aspx 中央社：加拿大媒體調查報導\nhttps://www.leezen.com.tw/news/detail/366 里仁官方聲明',
}

const meta = {
  title: 'components/FactCheckDraftPanel',
  component: FactCheckDraftPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      // A fresh cache per story, so one story's edits don't leak into the next.
      <QueryClientProvider client={new QueryClient()}>
        <div className="flex h-[720px] max-w-[480px] flex-col">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    toolCallId: 'adk-draft-1',
    args,
    context: {
      sessionId: 'story-session',
      userName: 'Jack5566',
      lockReason: null,
      articleId: 'article-1',
      onOpenLatestDraft: fn(),
    },
  },
} satisfies Meta<typeof FactCheckDraftPanel>

export default meta
type Story = StoryObj<typeof meta>

/** The latest draft: editable, with 「送出查核回應」 at the bottom. */
export const Editable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const text = canvas.getByLabelText('回應內容')
    await userEvent.type(text, '（補充）')
    await expect(canvas.getByText('已修改')).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: /含有不實訊息/ }))
    await expect(
      canvas.getByRole('radio', { name: /含有不實訊息/ }),
    ).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(canvas.getByRole('button', { name: '送出查核回應' }))
    // The confirmation dialog renders in a portal, outside the canvas.
    const dialog = within(document.body)
    await expect(await dialog.findByRole('dialog')).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: '確定送出' }),
    ).toBeDisabled()
    await userEvent.click(dialog.getByText('我已經檢查過回應內文與出處'))
    await userEvent.click(dialog.getByText(/我願意用「Jack5566」的身份/))
    await expect(dialog.getByRole('button', { name: '確定送出' })).toBeEnabled()
    // Undo the edits so localStorage doesn't carry them into the next run.
    await userEvent.click(dialog.getByRole('button', { name: '取消' }))
    // Wait out the close animation.
    await waitFor(() => expect(dialog.queryByRole('dialog')).toBeNull())
    await userEvent.click(
      canvas.getByRole('button', { name: /還原成 AI 的版本/ }),
    )
  },
}

/** A chat that started from pasted text has no Cofacts article to reply to. */
export const NoArticle: Story = {
  args: {
    context: {
      sessionId: 'story-session',
      userName: 'Jack5566',
      lockReason: null,
      articleId: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: '送出查核回應' }),
    ).toBeDisabled()
  },
}

/** The user's edits were sent to the AI with a chat message, so this draft is read-only. */
export const LockedAfterSending: Story = {
  args: {
    context: {
      sessionId: 'story-session',
      userName: 'Jack5566',
      lockReason: 'sent',
      articleId: 'article-1',
      onOpenLatestDraft: fn(),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(
      canvas.queryByRole('button', { name: '送出查核回應' }),
    ).toBeNull()
  },
}

export const Superseded: Story = {
  args: {
    context: {
      sessionId: 'story-session',
      userName: 'Jack5566',
      lockReason: 'superseded',
      articleId: 'article-1',
      onOpenLatestDraft: fn(),
    },
  },
}

export const WhileAiIsAnswering: Story = {
  args: {
    context: {
      sessionId: 'story-session',
      userName: 'Jack5566',
      lockReason: 'streaming',
      articleId: 'article-1',
    },
  },
}
