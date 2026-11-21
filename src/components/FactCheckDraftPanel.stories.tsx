import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, fn, userEvent, within } from 'storybook/test'

import { FactCheckDraftPanel } from './FactCheckDraftPanel'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { DraftPanelContext } from './FactCheckDraftPanel'
import type { DraftFields } from '@/lib/factCheckDraft'

const args = {
  classification: 'OPINIONATED',
  text: '這則訊息結合了已發生的食安爭議、媒體調查報導，以及對宗教團體政治立場的個人觀點與擔憂。\n\n1. 關於石虎米農藥爭議：2023 年初，石虎米品牌商確實因檢驗出農藥殘留，與契作農友產生拒收爭議。',
  references:
    'https://www.cna.com.tw/news/aopl/202506200337.aspx 中央社：加拿大媒體調查報導\nhttps://www.leezen.com.tw/news/detail/366 里仁官方聲明',
}

const ARTICLE = {
  id: 'article-1',
  text: '里仁和石虎米都有問題，大家不要再買了！',
}
const SIMILAR = {
  id: 'article-2',
  text: '里仁被加拿大媒體爆料，背後的宗教團體…',
}

/** The editable latest draft for article-1, with no earlier reply from the user. */
const context = {
  sessionId: 'story-session',
  userName: 'Jack5566',
  lockReason: null,
  sentEdit: null,
  targetArticleIds: [ARTICLE.id],
  articles: [ARTICLE],
  myReplies: {},
  onSubmitted: fn(),
  onOpenLatestDraft: fn(),
} satisfies DraftPanelContext

/** What the user sent the AI after editing: a different category and a shorter text. */
const sentEdit = {
  classification: 'RUMOR',
  text: '這則訊息有誤導之處（我修改過的版本）。',
  references: args.references,
} satisfies DraftFields

/** A typical edit: one paragraph added, one source line rewritten. */
const sentEditWithAddition = {
  classification: 'OPINIONATED',
  text: args.text + '\n\n💡 如果想知道里仁的說明，可以到里仁官網查詢。',
  references:
    'https://www.cna.com.tw/news/aopl/202506200337.aspx 中央社：加拿大媒體調查報導（2025/6/20）\nhttps://www.leezen.com.tw/news/detail/366 里仁官方聲明',
} satisfies DraftFields

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
  args: { toolCallId: 'adk-draft-1', args, context },
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
    const submit = canvas.getByRole('button', {
      name: /用.Jack5566.的身份送出查核回應/,
    })
    await expect(submit).toBeDisabled()
    await userEvent.click(canvas.getByText('我已經檢查過回應內文與出處'))
    await expect(submit).toBeEnabled()
    // Editing after checking keeps the check.
    await userEvent.type(text, '！')
    await expect(submit).toBeEnabled()
    // One article in the chat: no need to say which one the reply is for.
    await expect(canvas.queryByText('這則回應要回覆的訊息')).toBeNull()
    // Undo the edits so localStorage doesn't carry them into the next run.
    await userEvent.click(
      canvas.getByRole('button', { name: /還原成 AI 的版本/ }),
    )
  },
}

/**
 * The user's edits went to the AI with a chat message and no newer draft came back, so the
 * draft stays editable and shows what the user sent.
 */
export const EditedAndSent: Story = {
  args: {
    toolCallId: 'adk-draft-sent',
    context: { ...context, sentEdit },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('回應內容')).toHaveValue(sentEdit.text)
    await expect(canvas.getByText('已修改')).toBeVisible()
    await expect(
      canvas.getByRole('radio', { name: /含有不實訊息/ }),
    ).toHaveAttribute('aria-checked', 'true')
  },
}

/**
 * The user sent their edits with a chat message and the AI is answering: read-only, showing the
 * version they sent with their changes marked against the AI's, so the edits don't look lost.
 */
export const SentWhileAiIsAnswering: Story = {
  args: {
    toolCallId: 'adk-draft-sending',
    context: {
      ...context,
      lockReason: 'streaming',
      sentEdit: sentEditWithAddition,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByText(/AI 正在依你的修改更新草稿/)).toBeVisible()
    await expect(canvas.getByText(/藍色底線是你修改過的內容/)).toBeVisible()
    await expect(canvas.getByText(/到里仁官網查詢/)).toBeVisible()
  },
}

/** A newer draft replaced this one; it shows the version the user sent, marked, read-only. */
export const Superseded: Story = {
  args: {
    toolCallId: 'adk-draft-old',
    context: {
      ...context,
      lockReason: 'superseded',
      sentEdit: sentEditWithAddition,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByText(/到里仁官網查詢/)).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: '開啟最新草稿' }),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('button', { name: /送出查核回應/ }),
    ).toBeNull()
  },
}

/** The AI's new draft, revised from the user's edits to the previous one. */
export const RevisedFromUserEdit: Story = {
  args: {
    toolCallId: 'adk-draft-revised',
    context: { ...context, revisedFromUserEdit: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('這是 AI 依你的修改產生的新草稿。'),
    ).toBeVisible()
  },
}

export const WhileAiIsAnswering: Story = {
  args: { context: { ...context, lockReason: 'streaming' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** The chat looked at a similar article too, so the drawer says which one the reply is for. */
export const SeveralArticles: Story = {
  args: { context: { ...context, articles: [ARTICLE, SIMILAR] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const targets = canvas.getByRole('region', { name: '這則回應要回覆的訊息' })
    await expect(within(targets).getByText(ARTICLE.text)).toBeVisible()
    await expect(within(targets).queryByText(SIMILAR.text)).toBeNull()
  },
}

/** Several articles and the writer named none: there is nothing safe to submit to. */
export const NoTargetNamed: Story = {
  args: {
    context: { ...context, articles: [ARTICLE, SIMILAR], targetArticleIds: [] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/AI 沒有指定這份草稿/)).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: /送出查核回應/ }),
    ).toBeDisabled()
  },
}

/** A chat that started from pasted text has no Cofacts article to reply to. */
export const NoArticle: Story = {
  args: { context: { ...context, articles: [], targetArticleIds: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /送出查核回應/ }),
    ).toBeDisabled()
  },
}

/** The user already replied to this article: a link to it, and a plain 「再次送出」 button. */
export const AlreadyReplied: Story = {
  args: { context: { ...context, myReplies: { [ARTICLE.id]: ['reply-1'] } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('link', { name: '查看你的回應' }),
    ).toHaveAttribute('href', 'https://cofacts.tw/reply/reply-1')
    await expect(
      canvas.getByRole('button', { name: /以.Jack5566.的身份再次送出新回應/ }),
    ).toBeVisible()
  },
}
