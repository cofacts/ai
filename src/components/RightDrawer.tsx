import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchSuggestions } from './SearchSuggestions'
import type { AllTools, ToolInvocation, ToolSource } from '@/lib/adk'
import { getArticleAttachmentUrl } from '@/server/articles.functions'

interface RightDrawerProps {
  isOpen: boolean
  onClose: () => void
  invocation: ToolInvocation | null
  /** Submission order (1-indexed) when `invocation` is a `draft_factcheck_response` call. */
  draftVersion?: number
}

export function RightDrawer({
  isOpen,
  onClose,
  invocation,
  draftVersion,
}: RightDrawerProps) {
  return (
    <>
      {/* Desktop drawer */}
      {isOpen && (
        <aside className="hidden md:flex flex-1 min-w-0 bg-white border-l border-border-subtle flex-col shadow-lg z-10 overflow-hidden [view-transition-name:right-drawer]">
          <DrawerHeader
            invocation={invocation}
            onClose={onClose}
            draftVersion={draftVersion}
          />
          <DrawerContent invocation={invocation} draftVersion={draftVersion} />
        </aside>
      )}

      {/* Mobile bottom sheet */}
      <MobileBottomSheet isOpen={isOpen} onClose={onClose}>
        <DrawerHeader
          invocation={invocation}
          onClose={onClose}
          draftVersion={draftVersion}
        />
        <DrawerContent invocation={invocation} draftVersion={draftVersion} />
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

function toolTitle(
  invocation: ToolInvocation | null,
  draftVersion?: number,
): string {
  if (!invocation) return 'Tool'
  if (invocation.name === 'get_single_cofacts_article') {
    const id = invocation.args.article_id ?? invocation.resp?.article_id
    return id ? `Cofacts 訊息 ${id}` : 'Cofacts 訊息'
  }
  const name = toolDisplayName(invocation.name)
  return draftVersion !== undefined ? `${name} · 第 ${draftVersion} 版` : name
}

function DrawerHeader({
  invocation,
  onClose,
  draftVersion,
}: {
  invocation: ToolInvocation | null
  onClose: () => void
  draftVersion?: number
}) {
  const cofactsArticleId =
    invocation?.name === 'get_single_cofacts_article'
      ? (invocation.args.article_id ?? invocation.resp?.article_id)
      : undefined

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-white shrink-0">
      <h2 className="text-sm font-semibold text-gray-800 truncate flex-1 min-w-0">
        {toolTitle(invocation, draftVersion)}
      </h2>
      <div className="flex items-center gap-1 shrink-0">
        {cofactsArticleId && (
          <a
            href={`https://cofacts.tw/article/${cofactsArticleId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="在 Cofacts 查看"
          >
            <span className="material-symbols-outlined text-xl">
              open_in_new
            </span>
          </a>
        )}
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="關閉"
        >
          <span className="material-symbols-outlined text-xl">close</span>
        </button>
      </div>
    </div>
  )
}

// ── Content router ───────────────────────────────────────────────

function DrawerContent({
  invocation,
  draftVersion,
}: {
  invocation: ToolInvocation | null
  draftVersion?: number
}) {
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
      return (
        <DraftFactcheckContent
          args={invocation.args}
          draftVersion={draftVersion}
        />
      )
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
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
      {children}
    </p>
  )
}

function MarkdownSection({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-1.5 leading-relaxed text-sm text-gray-800">
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
      className="block bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors border border-gray-100"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="material-symbols-outlined text-[13px] text-gray-400">
          language
        </span>
        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide truncate">
          {domain}
        </span>
      </div>
      <p className="text-[11px] text-gray-600 leading-snug line-clamp-2 break-all">
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
  const content = response
    ? 'content' in response
      ? response.content
      : response.result
    : ''
  const sources = response && 'content' in response ? response.sources : []

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {args.request && (
        <section>
          <SectionLabel>調查主題</SectionLabel>
          <MarkdownSection content={args.request} />
        </section>
      )}

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
          <div className="space-y-2">
            {sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {!content && !response && (
        <p className="text-sm text-gray-400 text-center pt-8">等待調查結果…</p>
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
  const content = response
    ? 'content' in response
      ? response.content
      : response.result
    : ''
  const sources = response && 'content' in response ? response.sources : []

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {args.request && (
        <section>
          <SectionLabel>待查核聲明</SectionLabel>
          <MarkdownSection content={args.request} />
        </section>
      )}

      {content && (
        <section>
          <SectionLabel>查核報告</SectionLabel>
          <MarkdownSection content={content} />
        </section>
      )}

      {sources.length > 0 && (
        <section>
          <SectionLabel>參考來源 ({sources.length})</SectionLabel>
          <div className="space-y-2">
            {sources.map((s, i) => (
              <SourceCard key={i} source={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {!content && !response && (
        <p className="text-sm text-gray-400 text-center pt-8">等待查核結果…</p>
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
  const result = response?.result ?? ''

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {args.request && (
        <section>
          <SectionLabel>詢問事項</SectionLabel>
          <MarkdownSection content={args.request} />
        </section>
      )}

      {result && (
        <section>
          <SectionLabel>讀者視角回應</SectionLabel>
          <MarkdownSection content={result} />
        </section>
      )}

      {!result && !response && (
        <p className="text-sm text-gray-400 text-center pt-8">等待回應…</p>
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
      className="ml-auto text-gray-400 hover:text-gray-600 disabled:opacity-0 transition-colors"
      aria-label="複製"
    >
      <span className="material-symbols-outlined text-base">
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
    colorClass: 'text-yellow-500',
    activeClass: 'bg-yellow-50 border-yellow-300 text-yellow-700',
  },
  {
    key: 'RUMOR',
    label: '含有不實訊息',
    icon: 'cancel',
    colorClass: 'text-red-500',
    activeClass: 'bg-red-50 border-red-300 text-red-700',
  },
  {
    key: 'NOT_RUMOR',
    label: '含有正確訊息',
    icon: 'check_circle',
    colorClass: 'text-green-500',
    activeClass: 'bg-green-50 border-green-300 text-green-700',
  },
  {
    key: 'OPINIONATED',
    label: '含有個人意見',
    icon: 'comment',
    colorClass: 'text-blue-500',
    activeClass: 'bg-blue-50 border-blue-300 text-blue-700',
  },
]

function DraftFactcheckContent({
  args,
  draftVersion,
}: {
  args: AllTools['draft_factcheck_response']['args']
  draftVersion?: number
}) {
  const classification = args.classification as ReplyCategory | undefined
  const text = args.text ?? ''
  const references = args.references ?? ''

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-background-light">
      {draftVersion !== undefined && (
        <p className="text-xs text-gray-400">
          第 {draftVersion} 版提案 — 若要請 AI 引用此版本，可告知「第 {draftVersion}{' '}
          版」
        </p>
      )}

      {/* Classification */}
      <div className="flex flex-row gap-1 p-1 bg-gray-100 rounded-lg w-full overflow-x-auto no-scrollbar">
        {CATEGORIES.map((cat) => {
          const isActive = classification === cat.key
          return (
            <div
              key={cat.key}
              className={`
                flex-1 min-w-[80px] whitespace-nowrap py-2 text-[10px] font-bold text-center rounded
                flex flex-col items-center justify-center gap-0.5
                ${
                  isActive
                    ? `bg-white shadow-sm border border-gray-200 ${cat.activeClass}`
                    : 'text-gray-400'
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
      <div className="space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center">
          回應內容
          <CopyButton value={text} />
        </label>
        <div className="w-full min-h-[11rem] p-3 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg leading-relaxed whitespace-pre-wrap">
          {text || <span className="text-gray-300">（尚未產生）</span>}
        </div>
      </div>

      {/* References */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">link</span>
          佐證資料
          <CopyButton value={references} />
        </label>
        <div className="w-full min-h-[8rem] p-3 text-sm font-mono text-gray-700 bg-white border border-gray-200 rounded-lg leading-relaxed whitespace-pre-wrap">
          {references || <span className="text-gray-300">（尚未產生）</span>}
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
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
  NOT_RUMOR: {
    label: '不含不實訊息',
    className: 'bg-green-50 text-green-700 border border-green-200',
  },
  OPINIONATED: {
    label: '含有個人意見',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  NOT_ARTICLE: {
    label: '不是可查核的內容',
    className: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  },
}

function RelatedArticleCard({ article }: { article: RelatedArticleNode }) {
  return (
    <a
      href={`https://cofacts.tw/article/${article.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 w-[210px] rounded-lg border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100 transition-colors flex flex-col gap-2"
    >
      <p className="text-xs text-gray-700 line-clamp-4 leading-relaxed flex-1">
        {article.text || `[${article.articleType}]`}
      </p>
      <div>
        {article.factCheckCount > 0 ? (
          <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
            {article.factCheckCount} 則查核
          </span>
        ) : (
          <span className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
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
    return <div className="w-full h-48 rounded-lg bg-gray-100 animate-pulse" />
  }
  if (isError || !url) {
    return <p className="text-sm text-gray-400">附件載入失敗</p>
  }
  if (articleType === 'IMAGE') {
    return <img src={url} alt="訊息附件" className="w-full rounded-lg" />
  }
  if (articleType === 'VIDEO') {
    return <video src={url} controls className="w-full rounded-lg" />
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
      <p className="text-sm text-gray-400 text-center pt-8 p-4">
        等待資料載入…
      </p>
    )
  }

  if (response.error) {
    return (
      <p className="text-sm text-red-400 text-center pt-8 p-4">
        {response.error}
      </p>
    )
  }

  const article = response.article
  if (!article) {
    return (
      <p className="text-sm text-gray-400 text-center pt-8 p-4">找不到此訊息</p>
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
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
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
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {article.text}
          </p>
        </section>
      )}

      {/* Metadata */}
      <section>
        <SectionLabel>統計</SectionLabel>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">
              calendar_today
            </span>
            初次回報：{formattedDate}
          </span>
          {totalVisits > 0 && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">
                trending_up
              </span>
              近 90 天 {totalVisits.toLocaleString()} 次造訪
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">group</span>
            {article.communityDemandCount} 人回報
          </span>
        </div>
      </section>

      {/* Fact-check responses */}
      <section>
        <SectionLabel>查核回應（{article.factCheckCount}）</SectionLabel>
        {article.factCheckResponses.length === 0 ? (
          <p className="text-sm text-gray-400">尚無查核回應</p>
        ) : (
          <div className="space-y-3">
            {article.factCheckResponses.map((ar, i) => {
              const typeInfo = REPLY_TYPE_INFO[ar.reply.type] ?? {
                label: ar.reply.type,
                className: 'bg-gray-50 text-gray-700 border border-gray-200',
              }
              return (
                <div
                  key={i}
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2"
                >
                  <span
                    className={`inline-block text-[10px] font-bold rounded px-1.5 py-0.5 ${typeInfo.className}`}
                  >
                    {typeInfo.label}
                  </span>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {ar.reply.text}
                  </p>
                  {ar.reply.reference && (
                    <p className="text-xs text-gray-400 whitespace-pre-wrap">
                      {ar.reply.reference}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{ar.reply.user.name}</span>
                    <span className="flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-xs">
                        thumb_up
                      </span>
                      {ar.helpfulCount}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-xs">
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
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
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
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <section>
        <SectionLabel>Tool: {name}</SectionLabel>
        <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all border border-gray-100">
          {JSON.stringify(args, null, 2)}
        </pre>
      </section>
      {response && (
        <section>
          <SectionLabel>Response</SectionLabel>
          <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all border border-gray-100">
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
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className="absolute bottom-0 left-0 w-full flex flex-col bg-[#F5F5F5] rounded-t-2xl bottom-sheet-shadow transition-[height] duration-100 [view-transition-name:right-drawer-mobile]"
        style={{ height: `${sheetHeight}vh` }}
      >
        <div
          className="w-full flex justify-center pt-3 pb-1 cursor-grab touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>
        {children}
      </div>
    </div>
  )
}
