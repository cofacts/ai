import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import type { AllTools, ToolInvocation, ToolSource } from '@/lib/adk'
import { getArticleAttachmentUrl } from '@/server/articles.functions'
import './RightDrawer.css'

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
        <aside className="hidden md:flex flex-1 min-w-0 bg-base border-l border-subtle flex-col shadow-btn z-10 overflow-hidden [view-transition-name:right-drawer]">
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
    <div className="flex items-center gap-8 px-16 py-12 border-b border-subtle bg-base shrink-0">
      <h2 className="text-body-s font-bold text-primary truncate flex-1 min-w-0">
        {toolTitle(invocation)}
      </h2>
      <div className="flex items-center gap-4 shrink-0">
        {cofactsArticleId && (
          <a
            href={`https://cofacts.tw/article/${cofactsArticleId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-tertiary hover:text-secondary transition-colors"
            aria-label="在 Cofacts 查看"
          >
            <span className="material-symbols-outlined text-heading-s">
              open_in_new
            </span>
          </a>
        )}
        <button
          onClick={onClose}
          className="text-tertiary hover:text-secondary transition-colors"
          aria-label="關閉"
        >
          <span className="material-symbols-outlined text-heading-s">
            close
          </span>
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
    <p className="text-[10px] font-bold text-tertiary uppercase mb-8">
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
      <p className="text-body-s text-on-accent bg-accent-subtle border border-accent rounded-10 p-12 whitespace-pre-wrap">
        {message}
      </p>
    </section>
  )
}

function MarkdownSection({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-6 text-body-s text-primary">
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
      className="block bg-raised rounded-10 p-12 hover:bg-selected transition-colors border border-subtle"
    >
      <div className="flex items-center gap-6 mb-4">
        <span className="material-symbols-outlined text-[13px] text-tertiary">
          language
        </span>
        <span className="text-[10px] text-tertiary font-bold uppercase truncate">
          {domain}
        </span>
      </div>
      <p className="text-[11px] text-secondary line-clamp-2 break-all">
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
    <div className="flex-1 overflow-y-auto p-16 space-y-20">
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
          <div className="space-y-8">
            {sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {!content && !response && (
        <p className="text-body-s text-tertiary text-center pt-32">
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
    <div className="flex-1 overflow-y-auto p-16 space-y-20">
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
          <div className="space-y-8">
            {sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {!content && !response && (
        <p className="text-body-s text-tertiary text-center pt-32">
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
    <div className="flex-1 overflow-y-auto p-16 space-y-20">
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
        <p className="text-body-s text-tertiary text-center pt-32">等待回應…</p>
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
      className="ml-auto text-tertiary hover:text-secondary disabled:opacity-0 transition-colors"
      aria-label="複製"
    >
      <span className="material-symbols-outlined text-body-m">
        {copied ? 'check' : 'content_copy'}
      </span>
    </button>
  )
}

// ── Draft Factcheck ──────────────────────────────────────────────

type ReplyCategory = 'NOT_ARTICLE' | 'RUMOR' | 'NOT_RUMOR' | 'OPINIONATED'

const CATEGORIES: Array<{
  key: ReplyCategory
  label: string
  icon: string
  colorClass: string
  activeClass: string
}> = [
  {
    key: 'NOT_ARTICLE',
    label: '不在查證範圍',
    icon: 'warning',
    colorClass: 'text-status-outofscope',
    activeClass: 'bg-accent-subtle border-accent text-on-accent',
  },
  {
    key: 'RUMOR',
    label: '含有不實訊息',
    icon: 'cancel',
    colorClass: 'text-status-incorrect',
    activeClass: 'bg-raised border-control text-status-incorrect',
  },
  {
    key: 'NOT_RUMOR',
    label: '含有正確訊息',
    icon: 'check_circle',
    colorClass: 'text-status-correct',
    activeClass: 'bg-raised border-subtle text-status-correct',
  },
  {
    key: 'OPINIONATED',
    label: '含有個人意見',
    icon: 'comment',
    colorClass: 'text-status-opinion',
    activeClass: 'bg-raised border-subtle text-link',
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
    <div className="flex-1 overflow-y-auto p-16 space-y-20 bg-raised">
      {/* Classification */}
      <div className="flex flex-row gap-4 p-4 bg-raised rounded-10 w-full overflow-x-auto [scrollbar-width:none]">
        {CATEGORIES.map((cat) => {
          const isActive = classification === cat.key
          return (
            <div
              key={cat.key}
              className={`
                flex-1 min-w-[80px] whitespace-nowrap py-8 text-[10px] font-bold text-center rounded-5
                flex flex-col items-center justify-center gap-2
                ${
                  isActive
                    ? `bg-base shadow-btn border border-subtle ${cat.activeClass}`
                    : 'text-tertiary'
                }
              `}
            >
              <span
                className={`material-symbols-outlined text-[16px] ${isActive ? '' : cat.colorClass} ${isActive ? '' : 'opacity-40'}`}
              >
                {cat.icon}
              </span>
              <span>{cat.label}</span>
            </div>
          )
        })}
      </div>

      {/* Response text */}
      <div className="space-y-8">
        <label className="text-caption font-bold text-tertiary uppercase flex items-center">
          回應內容
          <CopyButton value={text} />
        </label>
        <div className="w-full min-h-[11rem] p-12 text-body-s text-primary bg-base border border-subtle rounded-10 whitespace-pre-wrap">
          {text || <span className="text-disabled">（尚未產生）</span>}
        </div>
      </div>

      {/* References */}
      <div className="space-y-8">
        <label className="text-caption font-bold text-tertiary uppercase flex items-center gap-4">
          <span className="material-symbols-outlined text-body-s">link</span>
          佐證資料
          <CopyButton value={references} />
        </label>
        <div className="w-full min-h-[8rem] p-12 text-body-s font-mono text-secondary bg-base border border-subtle rounded-10 whitespace-pre-wrap">
          {references || <span className="text-disabled">（尚未產生）</span>}
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
    className: 'bg-raised text-status-incorrect border border-control',
  },
  NOT_RUMOR: {
    label: '不含不實訊息',
    className: 'bg-raised text-status-correct border border-subtle',
  },
  OPINIONATED: {
    label: '含有個人意見',
    className: 'bg-raised text-link border border-subtle',
  },
  NOT_ARTICLE: {
    label: '不是可查核的內容',
    className: 'bg-accent-subtle text-on-accent border border-accent',
  },
}

function RelatedArticleCard({ article }: { article: RelatedArticleNode }) {
  return (
    <a
      href={`https://cofacts.tw/article/${article.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 w-[210px] rounded-10 border border-subtle bg-raised p-12 hover:bg-selected transition-colors flex flex-col gap-8"
    >
      <p className="text-caption text-secondary line-clamp-4 flex-1">
        {article.text || `[${article.articleType}]`}
      </p>
      <div>
        {article.factCheckCount > 0 ? (
          <span className="text-[10px] bg-raised text-status-correct border border-subtle rounded-5 px-6 py-2">
            {article.factCheckCount} 則查核
          </span>
        ) : (
          <span className="text-[10px] bg-raised text-tertiary rounded-5 px-6 py-2">
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
    return <div className="w-full h-192 rounded-10 bg-raised animate-pulse" />
  }
  if (isError || !url) {
    return <p className="text-body-s text-tertiary">附件載入失敗</p>
  }
  if (articleType === 'IMAGE') {
    return <img src={url} alt="訊息附件" className="w-full rounded-10" />
  }
  if (articleType === 'VIDEO') {
    return <video src={url} controls className="w-full rounded-10" />
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
      <p className="text-body-s text-tertiary text-center pt-32 p-16">
        等待資料載入…
      </p>
    )
  }

  if (response.error) {
    return (
      <p className="text-body-s text-status-incorrect text-center pt-32 p-16">
        {response.error}
      </p>
    )
  }

  const article = response.article
  if (!article) {
    return (
      <p className="text-body-s text-tertiary text-center pt-32 p-16">
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
    <div className="flex-1 overflow-y-auto p-16 space-y-20">
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
          <p className="text-body-s text-primary whitespace-pre-wrap">
            {article.text}
          </p>
        </section>
      )}

      {/* Metadata */}
      <section>
        <SectionLabel>統計</SectionLabel>
        <div className="flex flex-wrap gap-x-16 gap-y-6 text-caption text-secondary">
          <span className="flex items-center gap-4">
            <span className="material-symbols-outlined text-body-s">
              calendar_today
            </span>
            初次回報：{formattedDate}
          </span>
          {totalVisits > 0 && (
            <span className="flex items-center gap-4">
              <span className="material-symbols-outlined text-body-s">
                trending_up
              </span>
              近 90 天 {totalVisits.toLocaleString()} 次造訪
            </span>
          )}
          <span className="flex items-center gap-4">
            <span className="material-symbols-outlined text-body-s">group</span>
            {article.communityDemandCount} 人回報
          </span>
        </div>
      </section>

      {/* Fact-check responses */}
      <section>
        <SectionLabel>查核回應（{article.factCheckCount}）</SectionLabel>
        {article.factCheckResponses.length === 0 ? (
          <p className="text-body-s text-tertiary">尚無查核回應</p>
        ) : (
          <div className="space-y-12">
            {article.factCheckResponses.map((ar, i) => {
              const typeInfo = REPLY_TYPE_INFO[ar.reply.type] ?? {
                label: ar.reply.type,
                className: 'bg-raised text-secondary border border-subtle',
              }
              return (
                <div
                  key={i}
                  className="rounded-10 border border-subtle bg-raised p-12 space-y-8"
                >
                  <span
                    className={`inline-block text-[10px] font-bold rounded-5 px-6 py-2 ${typeInfo.className}`}
                  >
                    {typeInfo.label}
                  </span>
                  <p className="text-body-s text-primary whitespace-pre-wrap">
                    {ar.reply.text}
                  </p>
                  {ar.reply.reference && (
                    <p className="text-caption text-tertiary whitespace-pre-wrap">
                      {ar.reply.reference}
                    </p>
                  )}
                  <div className="flex items-center gap-8 text-caption text-tertiary">
                    <span>{ar.reply.user.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-caption">
                        thumb_up
                      </span>
                      {ar.helpfulCount}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-caption">
                        thumb_down
                      </span>
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
          <div className="flex gap-12 overflow-x-auto pb-8 -mx-16 px-16">
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
    <div className="flex-1 overflow-y-auto p-16 space-y-16">
      <section>
        <SectionLabel>Tool: {name}</SectionLabel>
        <pre className="text-caption bg-raised rounded-5 p-12 overflow-x-auto whitespace-pre-wrap break-all border border-subtle">
          {JSON.stringify(args, null, 2)}
        </pre>
      </section>
      {response && (
        <section>
          <SectionLabel>Response</SectionLabel>
          <pre className="text-caption bg-raised rounded-5 p-12 overflow-x-auto whitespace-pre-wrap break-all border border-subtle">
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
        className="absolute inset-0 bg-scrim backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className="absolute bottom-0 left-0 w-full flex flex-col bg-raised rounded-t-10 shadow-btn transition-[height] duration-100 [view-transition-name:right-drawer-mobile]"
        style={{ height: `${sheetHeight}vh` }}
      >
        <div
          className="w-full flex justify-center pt-12 pb-4 cursor-grab touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-48 h-6 bg-selected rounded-full" />
        </div>
        {children}
      </div>
    </div>
  )
}
