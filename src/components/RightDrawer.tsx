import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import styles from './RightDrawer.module.css'
import type { AllTools, ToolInvocation, ToolSource } from '@/lib/adk'
import type { MaterialSymbol } from '@/components/icons/material-symbols'
import { getArticleAttachmentUrl } from '@/server/articles.functions'
import { cn } from '@/lib/utils'
import { MaterialIcon } from '@/components/icons/MaterialIcon'

interface RightDrawerProps {
  isOpen: boolean
  onClose: () => void
  invocation: ToolInvocation | null
}

export function RightDrawer({ isOpen, onClose, invocation }: RightDrawerProps) {
  return (
    <>
      {/* Desktop drawer */}
      {isOpen && (
        <aside
          className={cn(
            'hidden md:flex flex-1 min-w-0 bg-surface-base border-l border-border-subtle flex-col shadow-btn-shadow z-10 overflow-hidden',
            styles.drawer,
          )}
        >
          <DrawerHeader invocation={invocation} onClose={onClose} />
          <DrawerContent invocation={invocation} />
        </aside>
      )}

      {/* Mobile bottom sheet */}
      <MobileBottomSheet isOpen={isOpen} onClose={onClose}>
        <DrawerHeader invocation={invocation} onClose={onClose} />
        <DrawerContent invocation={invocation} />
      </MobileBottomSheet>
    </>
  )
}

// ── Header ───────────────────────────────────────────────────────

function toolDisplayName(name: string | null | undefined): string {
  if (!name) return 'Tool'
  if (name === 'investigator') return 'AI 調查員'
  if (name === 'verifier') return 'AI 查核員'
  if (name.startsWith('proofreader_'))
    return `AI 讀者 (${name.replace('proofreader_', '').toUpperCase()})`
  if (name === 'draft_factcheck_response') return '查核回應草稿'
  if (name === 'get_single_cofacts_article') return 'Cofacts 訊息'
  return name
}

function toolTitle(invocation: ToolInvocation | null): string {
  if (!invocation) return 'Tool'
  if (invocation.name === 'get_single_cofacts_article') {
    const id = invocation.args.article_id ?? invocation.resp?.article_id
    return id ? `Cofacts 訊息 ${id}` : 'Cofacts 訊息'
  }
  return toolDisplayName(invocation.name)
}

function DrawerHeader({
  invocation,
  onClose,
}: {
  invocation: ToolInvocation | null
  onClose: () => void
}) {
  const cofactsArticleId =
    invocation?.name === 'get_single_cofacts_article'
      ? (invocation.args.article_id ?? invocation.resp?.article_id)
      : undefined

  return (
    <div className="flex items-center gap-spacing-8 px-spacing-16 py-spacing-12 border-b border-border-subtle bg-surface-base shrink-0">
      <h2 className="text-type-body-s font-bold text-text-primary truncate flex-1 min-w-0">
        {toolTitle(invocation)}
      </h2>
      <div className="flex items-center gap-spacing-4 shrink-0">
        {cofactsArticleId && (
          <a
            href={`https://cofacts.tw/article/${cofactsArticleId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-tertiary hover:text-text-secondary transition-colors"
            aria-label="在 Cofacts 查看"
          >
            <MaterialIcon name="open_in_new" size={24} />
          </a>
        )}
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="關閉"
        >
          <MaterialIcon name="close" size={24} />
        </button>
      </div>
    </div>
  )
}

// ── Content router ───────────────────────────────────────────────

function DrawerContent({ invocation }: { invocation: ToolInvocation | null }) {
  if (!invocation) return null

  switch (invocation.name) {
    case 'investigator':
      return (
        <InvestigatorContent
          args={invocation.args}
          response={invocation.resp}
          toolCallId={invocation.id}
        />
      )
    case 'verifier':
      return (
        <VerifierContent args={invocation.args} response={invocation.resp} />
      )
    case 'proofreader_kmt':
    case 'proofreader_dpp':
    case 'proofreader_tpp':
    case 'proofreader_minor_parties':
      return (
        <ProofreaderContent args={invocation.args} response={invocation.resp} />
      )
    case 'draft_factcheck_response':
      return <DraftFactcheckContent args={invocation.args} />
    case 'get_single_cofacts_article':
      return <CofactsArticleContent response={invocation.resp} />
    default: {
      const t = invocation as unknown as {
        name: string
        args: Record<string, unknown>
        resp: Record<string, unknown> | null
      }
      return (
        <GenericToolContent name={t.name} args={t.args} response={t.resp} />
      )
    }
  }
}

// ── Shared sub-components ────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-text-tertiary uppercase mb-spacing-8">
      {children}
    </p>
  )
}

/**
 * A sub-agent call that failed instead of answering — a timeout, or a call
 * cancelled because its citations didn't resolve. The writer sees the same
 * message and is expected to retry, so surfacing it explains the gap.
 */
function ToolErrorSection({ message }: { message: string }) {
  return (
    <section>
      <SectionLabel>這次呼叫沒有成功</SectionLabel>
      <p className="text-type-body-s text-text-on-accent bg-surface-accent-subtle border border-border-accent rounded-radius-10 p-spacing-12 whitespace-pre-wrap">
        {message}
      </p>
    </section>
  )
}

function MarkdownSection({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-6 text-type-body-s text-text-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function SourceCard({ source, index }: { source: ToolSource; index: number }) {
  const domain = source.url
    ? (() => {
        try {
          return new URL(source.url).hostname
        } catch {
          return source.url
        }
      })()
    : ''
  return (
    <a
      id={`source-${index}`}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-surface-raised rounded-radius-10 p-spacing-12 hover:bg-surface-selected transition-colors border border-border-subtle"
    >
      <div className="flex items-center gap-[6px] mb-spacing-4">
        <MaterialIcon
          name="language"
          size={24}
          className="text-text-tertiary"
        />
        <span className="text-[10px] text-text-tertiary font-bold uppercase truncate">
          {domain}
        </span>
      </div>
      <p className="text-[11px] text-text-secondary line-clamp-2 break-all">
        {source.url}
      </p>
    </a>
  )
}

// ── Investigator ─────────────────────────────────────────────────

function InvestigatorContent({
  args,
  response,
  toolCallId,
}: {
  args: AllTools['investigator']['args']
  response: AllTools['investigator']['resp'] | null
  toolCallId: string
}) {
  const errorMessage = response && 'error' in response ? response.message : null
  const content =
    response && !('error' in response)
      ? 'content' in response
        ? response.content
        : response.result
      : ''
  const sources =
    response && !('error' in response) && 'content' in response
      ? response.sources
      : []

  return (
    <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20">
      {args.request && (
        <section>
          <SectionLabel>調查主題</SectionLabel>
          <MarkdownSection content={args.request} />
        </section>
      )}

      {errorMessage && <ToolErrorSection message={errorMessage} />}

      {content && (
        <section>
          <SectionLabel>調查結果</SectionLabel>
          <MarkdownSection content={content} />
        </section>
      )}

      <SearchSuggestions toolCallId={toolCallId} className="overflow-x-auto" />

      {sources.length > 0 && (
        <section>
          <SectionLabel>出處 ({sources.length})</SectionLabel>
          <div className="space-y-spacing-8">
            {sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {!content && !response && (
        <p className="text-type-body-s text-text-tertiary text-center pt-spacing-32">
          等待調查結果…
        </p>
      )}
    </div>
  )
}

// ── Verifier ─────────────────────────────────────────────────────

function VerifierContent({
  args,
  response,
}: {
  args: AllTools['verifier']['args']
  response: AllTools['verifier']['resp'] | null
}) {
  const errorMessage = response && 'error' in response ? response.message : null
  const content =
    response && !('error' in response)
      ? 'content' in response
        ? response.content
        : response.result
      : ''
  const sources =
    response && !('error' in response) && 'content' in response
      ? response.sources
      : []

  return (
    <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20">
      {args.request && (
        <section>
          <SectionLabel>待查核聲明</SectionLabel>
          <MarkdownSection content={args.request} />
        </section>
      )}

      {errorMessage && <ToolErrorSection message={errorMessage} />}

      {content && (
        <section>
          <SectionLabel>查核報告</SectionLabel>
          <MarkdownSection content={content} />
        </section>
      )}

      {sources.length > 0 && (
        <section>
          <SectionLabel>參考來源 ({sources.length})</SectionLabel>
          <div className="space-y-spacing-8">
            {sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {!content && !response && (
        <p className="text-type-body-s text-text-tertiary text-center pt-spacing-32">
          等待查核結果…
        </p>
      )}
    </div>
  )
}

// ── Proofreader ──────────────────────────────────────────────────

function ProofreaderContent({
  args,
  response,
}: {
  args: AllTools['proofreader_kmt']['args']
  response: AllTools['proofreader_kmt']['resp'] | null
}) {
  const errorMessage = response && 'error' in response ? response.message : null
  const result = response && !('error' in response) ? response.result : ''

  return (
    <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20">
      {args.request && (
        <section>
          <SectionLabel>詢問事項</SectionLabel>
          <MarkdownSection content={args.request} />
        </section>
      )}

      {errorMessage && <ToolErrorSection message={errorMessage} />}

      {result && (
        <section>
          <SectionLabel>讀者視角回應</SectionLabel>
          <MarkdownSection content={result} />
        </section>
      )}

      {!result && !response && (
        <p className="text-type-body-s text-text-tertiary text-center pt-spacing-32">
          等待回應…
        </p>
      )}
    </div>
  )
}

// ── Copy button ──────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      disabled={!value}
      className="ml-auto text-text-tertiary hover:text-text-secondary disabled:opacity-0 transition-colors"
      aria-label="複製"
    >
      <MaterialIcon name={copied ? 'check' : 'content_copy'} size={24} />
    </button>
  )
}

// ── Draft Factcheck ──────────────────────────────────────────────

type ReplyCategory = 'NOT_ARTICLE' | 'RUMOR' | 'NOT_RUMOR' | 'OPINIONATED'

const CATEGORIES: Array<{
  key: ReplyCategory
  label: string
  icon: MaterialSymbol
  colorClass: string
  activeClass: string
}> = [
  {
    key: 'NOT_ARTICLE',
    label: '不在查證範圍',
    icon: 'warning',
    colorClass: 'text-status-outofscope',
    activeClass:
      'bg-surface-accent-subtle border-border-accent text-text-on-accent',
  },
  {
    key: 'RUMOR',
    label: '含有不實訊息',
    icon: 'cancel',
    colorClass: 'text-status-incorrect',
    activeClass:
      'bg-surface-raised border-border-control text-status-incorrect',
  },
  {
    key: 'NOT_RUMOR',
    label: '含有正確訊息',
    icon: 'check_circle',
    colorClass: 'text-status-correct',
    activeClass: 'bg-surface-raised border-border-subtle text-status-correct',
  },
  {
    key: 'OPINIONATED',
    label: '含有個人意見',
    icon: 'comment',
    colorClass: 'text-status-opinion',
    activeClass: 'bg-surface-raised border-border-subtle text-text-link',
  },
]

function DraftFactcheckContent({
  args,
}: {
  args: AllTools['draft_factcheck_response']['args']
}) {
  const classification = args.classification as ReplyCategory | undefined
  const text = args.text ?? ''
  const references = args.references ?? ''

  return (
    <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20 bg-surface-raised">
      {/* Classification */}
      <div className="flex flex-row gap-spacing-4 p-spacing-4 bg-surface-raised rounded-radius-10 w-full overflow-x-auto [scrollbar-width:none]">
        {CATEGORIES.map((cat) => {
          const isActive = classification === cat.key
          return (
            <div
              key={cat.key}
              className={`
                flex-1 min-w-[80px] whitespace-nowrap py-spacing-8 text-[10px] font-bold text-center rounded-radius-5
                flex flex-col items-center justify-center gap-spacing-2
                ${
                  isActive
                    ? `bg-surface-base shadow-btn-shadow border border-border-subtle ${cat.activeClass}`
                    : 'text-text-tertiary'
                }
              `}
            >
              <MaterialIcon
                name={cat.icon}
                size={24}
                className={`${isActive ? '' : cat.colorClass} ${isActive ? '' : 'opacity-40'}`}
              />
              <span>{cat.label}</span>
            </div>
          )
        })}
      </div>

      {/* Response text */}
      <div className="space-y-spacing-8">
        <label className="text-type-caption font-bold text-text-tertiary uppercase flex items-center">
          回應內容
          <CopyButton value={text} />
        </label>
        <div className="w-full min-h-[11rem] p-spacing-12 text-type-body-s text-text-primary bg-surface-base border border-border-subtle rounded-radius-10 whitespace-pre-wrap">
          {text || <span className="text-text-disabled">（尚未產生）</span>}
        </div>
      </div>

      {/* References */}
      <div className="space-y-spacing-8">
        <label className="text-type-caption font-bold text-text-tertiary uppercase flex items-center gap-spacing-4">
          <MaterialIcon name="link" size={24} />
          佐證資料
          <CopyButton value={references} />
        </label>
        <div className="w-full min-h-[8rem] p-spacing-12 text-type-body-s font-mono text-text-secondary bg-surface-base border border-border-subtle rounded-radius-10 whitespace-pre-wrap">
          {references || (
            <span className="text-text-disabled">（尚未產生）</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Cofacts Article ──────────────────────────────────────────────

type CofactsArticle = NonNullable<
  AllTools['get_single_cofacts_article']['resp']['article']
>
type RelatedArticleNode =
  CofactsArticle['relatedArticles']['edges'][number]['node']

const REPLY_TYPE_INFO: Record<string, { label: string; className: string }> = {
  RUMOR: {
    label: '含有不實訊息',
    className:
      'bg-surface-raised text-status-incorrect border border-border-control',
  },
  NOT_RUMOR: {
    label: '不含不實訊息',
    className:
      'bg-surface-raised text-status-correct border border-border-subtle',
  },
  OPINIONATED: {
    label: '含有個人意見',
    className: 'bg-surface-raised text-text-link border border-border-subtle',
  },
  NOT_ARTICLE: {
    label: '不是可查核的內容',
    className:
      'bg-surface-accent-subtle text-text-on-accent border border-border-accent',
  },
}

function RelatedArticleCard({ article }: { article: RelatedArticleNode }) {
  return (
    <a
      href={`https://cofacts.tw/article/${article.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 w-[210px] rounded-radius-10 border border-border-subtle bg-surface-raised p-spacing-12 hover:bg-surface-selected transition-colors flex flex-col gap-spacing-8"
    >
      <p className="text-type-caption text-text-secondary line-clamp-4 flex-1">
        {article.text || `[${article.articleType}]`}
      </p>
      <div>
        {article.factCheckCount > 0 ? (
          <span className="text-[10px] bg-surface-raised text-status-correct border border-border-subtle rounded-radius-5 px-[6px] py-spacing-2">
            {article.factCheckCount} 則查核
          </span>
        ) : (
          <span className="text-[10px] bg-surface-raised text-text-tertiary rounded-radius-5 px-[6px] py-spacing-2">
            待查核
          </span>
        )}
      </div>
    </a>
  )
}

// Fetches a browser-loadable, freshly signed attachment URL for the article
// (the tool result only carries a non-loadable gs:// URI). Kept as its own
// component so the useQuery hook is unconditional — CofactsArticleContent
// returns early before it would reach a hook.
function ArticleMedia({
  articleId,
  articleType,
}: {
  articleId: string
  articleType: string
}) {
  const {
    data: url,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['cofacts-article-attachment', articleId],
    queryFn: () => getArticleAttachmentUrl({ data: articleId }),
    staleTime: Infinity,
  })

  if (isPending) {
    return (
      <div className="w-full h-[192px] rounded-radius-10 bg-surface-raised animate-pulse" />
    )
  }
  if (isError || !url) {
    return <p className="text-type-body-s text-text-tertiary">附件載入失敗</p>
  }
  if (articleType === 'IMAGE') {
    return <img src={url} alt="訊息附件" className="w-full rounded-radius-10" />
  }
  if (articleType === 'VIDEO') {
    return <video src={url} controls className="w-full rounded-radius-10" />
  }
  if (articleType === 'AUDIO') {
    return <audio src={url} controls className="w-full" />
  }
  return null
}

function CofactsArticleContent({
  response,
}: {
  response: AllTools['get_single_cofacts_article']['resp'] | null
}) {
  if (!response) {
    return (
      <p className="text-type-body-s text-text-tertiary text-center pt-spacing-32 p-spacing-16">
        等待資料載入…
      </p>
    )
  }

  if (response.error) {
    return (
      <p className="text-type-body-s text-status-incorrect text-center pt-spacing-32 p-spacing-16">
        {response.error}
      </p>
    )
  }

  const article = response.article
  if (!article) {
    return (
      <p className="text-type-body-s text-text-tertiary text-center pt-spacing-32 p-spacing-16">
        找不到此訊息
      </p>
    )
  }

  const isMedia = article.articleType !== 'TEXT'
  const totalVisits = article.stats.reduce(
    (sum, s) => sum + s.lineVisit + s.webVisit + s.downstreamBotVisits,
    0,
  )
  const formattedDate = new Date(article.createdAt).toLocaleDateString(
    'zh-TW',
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    },
  )
  const relatedEdges = article.relatedArticles.edges

  return (
    <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-20">
      {/* Media attachment — attachmentUrl from the tool is a gs:// URI the
          browser can't load, so ArticleMedia fetches a fresh signed URL. */}
      {isMedia && article.attachmentUrl && (
        <section>
          <ArticleMedia
            articleId={article.id}
            articleType={article.articleType}
          />
        </section>
      )}

      {/* Text content */}
      {article.text && (
        <section>
          <SectionLabel>{isMedia ? '逐字稿' : '訊息內文'}</SectionLabel>
          <p className="text-type-body-s text-text-primary whitespace-pre-wrap">
            {article.text}
          </p>
        </section>
      )}

      {/* Metadata */}
      <section>
        <SectionLabel>統計</SectionLabel>
        <div className="flex flex-wrap gap-x-spacing-16 gap-y-[6px] text-type-caption text-text-secondary">
          <span className="flex items-center gap-spacing-4">
            <MaterialIcon name="calendar_today" size={24} />
            初次回報：{formattedDate}
          </span>
          {totalVisits > 0 && (
            <span className="flex items-center gap-spacing-4">
              <MaterialIcon name="trending_up" size={24} />近 90 天{' '}
              {totalVisits.toLocaleString()} 次造訪
            </span>
          )}
          <span className="flex items-center gap-spacing-4">
            <MaterialIcon name="group" size={24} />
            {article.communityDemandCount} 人回報
          </span>
        </div>
      </section>

      {/* Fact-check responses */}
      <section>
        <SectionLabel>查核回應（{article.factCheckCount}）</SectionLabel>
        {article.factCheckResponses.length === 0 ? (
          <p className="text-type-body-s text-text-tertiary">尚無查核回應</p>
        ) : (
          <div className="space-y-spacing-12">
            {article.factCheckResponses.map((ar, i) => {
              const typeInfo = REPLY_TYPE_INFO[ar.reply.type] ?? {
                label: ar.reply.type,
                className:
                  'bg-surface-raised text-text-secondary border border-border-subtle',
              }
              return (
                <div
                  key={i}
                  className="rounded-radius-10 border border-border-subtle bg-surface-raised p-spacing-12 space-y-spacing-8"
                >
                  <span
                    className={`inline-block text-[10px] font-bold rounded-radius-5 px-[6px] py-spacing-2 ${typeInfo.className}`}
                  >
                    {typeInfo.label}
                  </span>
                  <p className="text-type-body-s text-text-primary whitespace-pre-wrap">
                    {ar.reply.text}
                  </p>
                  {ar.reply.reference && (
                    <p className="text-type-caption text-text-tertiary whitespace-pre-wrap">
                      {ar.reply.reference}
                    </p>
                  )}
                  <div className="flex items-center gap-spacing-8 text-type-caption text-text-tertiary">
                    <span>{ar.reply.user.name}</span>
                    <span className="flex items-center gap-spacing-2">
                      <MaterialIcon name="thumb_up" size={24} />
                      {ar.helpfulCount}
                    </span>
                    <span className="flex items-center gap-spacing-2">
                      <MaterialIcon name="thumb_down" size={24} />
                      {ar.unhelpfulCount}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Related articles carousel */}
      {relatedEdges.length > 0 && (
        <section>
          <SectionLabel>
            相似可疑訊息（{article.relatedArticles.totalCount}）
          </SectionLabel>
          <div className="flex gap-spacing-12 overflow-x-auto pb-spacing-8 -mx-spacing-16 px-spacing-16">
            {relatedEdges.map(({ node }) => (
              <RelatedArticleCard key={node.id} article={node} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Generic fallback ─────────────────────────────────────────────

function GenericToolContent({
  name,
  args,
  response,
}: {
  name: string | null | undefined
  args: Record<string, unknown>
  response: Record<string, unknown> | null
}) {
  return (
    <div className="flex-1 overflow-y-auto p-spacing-16 space-y-spacing-16">
      <section>
        <SectionLabel>Tool: {name}</SectionLabel>
        <pre className="text-type-caption bg-surface-raised rounded-radius-5 p-spacing-12 overflow-x-auto whitespace-pre-wrap break-all border border-border-subtle">
          {JSON.stringify(args, null, 2)}
        </pre>
      </section>
      {response && (
        <section>
          <SectionLabel>Response</SectionLabel>
          <pre className="text-type-caption bg-surface-raised rounded-radius-5 p-spacing-12 overflow-x-auto whitespace-pre-wrap break-all border border-border-subtle">
            {JSON.stringify(response, null, 2)}
          </pre>
        </section>
      )}
    </div>
  )
}

// ── Mobile bottom sheet ──────────────────────────────────────────

function MobileBottomSheet({
  isOpen,
  onClose,
  children,
}: {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const [sheetHeight, setSheetHeight] = useState(85)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      dragRef.current = {
        startY: touch.clientY,
        startHeight: sheetHeight,
      }
    },
    [sheetHeight],
  )

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return
    const touch = e.touches[0]
    if (!touch) return
    const delta = dragRef.current.startY - touch.clientY
    const windowHeight = window.innerHeight
    const deltaVh = (delta / windowHeight) * 100
    const newHeight = Math.max(
      40,
      Math.min(95, dragRef.current.startHeight + deltaVh),
    )
    setSheetHeight(newHeight)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!dragRef.current) return
    if (sheetHeight < 30) {
      onClose()
    } else if (sheetHeight < 60) {
      setSheetHeight(50)
    } else {
      setSheetHeight(85)
    }
    dragRef.current = null
  }, [sheetHeight, onClose])

  useEffect(() => {
    if (isOpen) setSheetHeight(85)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        className="absolute inset-0 bg-overlay-scrim backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute bottom-0 left-0 w-full flex flex-col bg-surface-raised rounded-t-radius-10 shadow-btn-shadow transition-[height] duration-100',
          styles.drawerMobile,
        )}
        style={{ height: `${sheetHeight}vh` }}
      >
        <div
          className="w-full flex justify-center pt-spacing-12 pb-spacing-4 cursor-grab touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-spacing-48 h-[6px] bg-surface-selected rounded-full" />
        </div>
        {children}
      </div>
    </div>
  )
}
