import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AllTools, FocusedTool } from '@/lib/adk'

interface RightDrawerProps {
  isOpen: boolean
  onClose: () => void
  tool: (FocusedTool & { id: string }) | null
}

export function RightDrawer({ isOpen, onClose, tool }: RightDrawerProps) {
  return (
    <>
      {/* Desktop drawer */}
      {isOpen && (
        <aside className="hidden md:flex w-[420px] bg-white border-l border-border-subtle flex-col shrink-0 shadow-lg z-10">
          <DrawerHeader tool={tool} onClose={onClose} />
          <DrawerContent tool={tool} />
        </aside>
      )}

      {/* Mobile bottom sheet */}
      <MobileBottomSheet isOpen={isOpen} onClose={onClose}>
        <DrawerHeader tool={tool} onClose={onClose} />
        <DrawerContent tool={tool} />
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
  return name
}

function DrawerHeader({
  tool,
  onClose,
}: {
  tool: (FocusedTool & { id: string }) | null
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-white shrink-0">
      <h2 className="text-sm font-semibold text-gray-800">
        {toolDisplayName(tool?.name)}
      </h2>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="關閉"
      >
        <span className="material-symbols-outlined text-xl">close</span>
      </button>
    </div>
  )
}

// ── Content router ───────────────────────────────────────────────

function DrawerContent({ tool }: { tool: (FocusedTool & { id: string }) | null }) {
  if (!tool) return null

  switch (tool.name) {
    case 'investigator':
      return <InvestigatorContent args={tool.args} response={tool.response} />
    case 'verifier':
      return <VerifierContent args={tool.args} response={tool.response} />
    case 'proofreader_kmt':
    case 'proofreader_dpp':
    case 'proofreader_tpp':
    case 'proofreader_minor_parties':
      return <ProofreaderContent args={tool.args} response={tool.response} />
    case 'draft_factcheck_response':
      return <DraftFactcheckContent args={tool.args} />
    default: {
      const t = tool as unknown as {
        name: string
        args: Record<string, unknown>
        response: Record<string, unknown> | null
      }
      return (
        <GenericToolContent name={t.name} args={t.args} response={t.response} />
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

type ToolSource = AllTools['investigator']['resp']['sources'][number]

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
      <p className="text-[13px] font-medium text-gray-800 leading-snug line-clamp-2">
        {source.title || source.url}
      </p>
    </a>
  )
}

// ── Investigator ─────────────────────────────────────────────────

type GroundingSupportItem =
  AllTools['investigator']['resp']['grounding_supports'][number]

function annotateGrounding(
  content: string,
  groundingSupports: GroundingSupportItem[],
  onScrollToSource: (id: number) => void,
): React.ReactNode[] {
  if (!groundingSupports.length) return [content]

  const sorted = [...groundingSupports].sort(
    (a, b) => a.segment.start_index - b.segment.start_index,
  )

  const nodes: React.ReactNode[] = []
  let cursor = 0

  for (const gs of sorted) {
    const { start_index, end_index } = gs.segment
    if (start_index > cursor) {
      nodes.push(content.slice(cursor, start_index))
    }
    const segment = content.slice(start_index, end_index)
    const ids = gs.source_ids
    nodes.push(
      <button
        key={start_index}
        onClick={() => onScrollToSource(ids[0])}
        className="bg-yellow-100 hover:bg-yellow-200 rounded px-0.5 transition-colors cursor-pointer text-left"
        title={`出處 ${ids.map((i) => i + 1).join(', ')}`}
      >
        {segment}
        <sup className="text-[9px] text-yellow-700 ml-0.5">
          [{ids.map((i) => i + 1).join(',')}]
        </sup>
      </button>,
    )
    cursor = end_index
  }
  if (cursor < content.length) {
    nodes.push(content.slice(cursor))
  }
  return nodes
}

function InvestigatorContent({
  args,
  response,
}: {
  args: AllTools['investigator']['args']
  response: AllTools['investigator']['resp'] | null
}) {
  const scrollToSource = useCallback((id: number) => {
    const el = document.getElementById(`source-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    el?.classList.add('ring-2', 'ring-primary')
    setTimeout(() => el?.classList.remove('ring-2', 'ring-primary'), 1500)
  }, [])

  const content = response?.content ?? ''
  const sources = response?.sources ?? []
  const groundingSupports = response?.grounding_supports ?? []
  const annotated = annotateGrounding(content, groundingSupports, scrollToSource)

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
          <div className="prose prose-sm max-w-none prose-p:my-1.5 leading-relaxed text-sm text-gray-800">
            {annotated}
          </div>
        </section>
      )}

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
  const content = response?.content ?? ''
  const sources = response?.sources ?? []

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
}: {
  args: AllTools['draft_factcheck_response']['args']
}) {
  const classification = args.classification as ReplyCategory | undefined
  const text = args.text ?? ''
  const references = args.references ?? ''

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-background-light">
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
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block">
          回應內容
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
        </label>
        <div className="w-full min-h-[8rem] p-3 text-sm font-mono text-gray-700 bg-white border border-gray-200 rounded-lg leading-relaxed whitespace-pre-wrap">
          {references || <span className="text-gray-300">（尚未產生）</span>}
        </div>
      </div>
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
      dragRef.current = {
        startY: e.touches[0].clientY,
        startHeight: sheetHeight,
      }
    },
    [sheetHeight],
  )

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current) return
    const delta = dragRef.current.startY - e.touches[0].clientY
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
        className="absolute bottom-0 left-0 w-full flex flex-col bg-[#F5F5F5] rounded-t-2xl bottom-sheet-shadow transition-[height] duration-100"
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
