import { useState } from 'react'

type ReplyCategory =
  | 'NOT_ARTICLE'
  | 'RUMOR'
  | 'NOT_RUMOR'
  | 'OPINIONATED'
  | null

interface ResponseEditorProps {
  draftResponse?: string
  onDraftChange?: (text: string) => void
}

const categories: Array<{
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

export function ResponseEditor({
  draftResponse = '',
  onDraftChange,
}: ResponseEditorProps) {
  const [selectedCategory, setSelectedCategory] = useState<ReplyCategory>(null)
  const [responseText, setResponseText] = useState(draftResponse)
  const [references, setReferences] = useState('')
  const [version] = useState(1)

  const handleTextChange = (text: string) => {
    setResponseText(text)
    onDraftChange?.(text)
  }

  const charCount = responseText.length

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-background-light">
      {/* Version selector */}
      <div className="flex items-center justify-between mb-2">
        <div className="relative group">
          <button className="flex items-center gap-1 text-sm font-medium text-gray-800 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 px-3 py-1.5 rounded-md transition-colors">
            <span>版本 {version} (目前)</span>
            <span className="material-symbols-outlined text-sm">
              arrow_drop_down
            </span>
          </button>
        </div>
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">
            cloud_done
          </span>{' '}
          已儲存
        </span>
      </div>

      {/* Category buttons */}
      <div className="flex flex-row gap-1 p-1 bg-gray-100 rounded-lg w-full overflow-x-auto no-scrollbar">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat.key
          return (
            <button
              key={cat.key}
              onClick={() => setSelectedCategory(isActive ? null : cat.key)}
              className={`
                flex-1 min-w-[80px] whitespace-nowrap py-2 text-[10px] font-bold text-center rounded
                flex flex-col items-center justify-center gap-0.5 transition-all
                ${
                  isActive
                    ? `bg-white shadow-sm border border-gray-200 ${cat.activeClass}`
                    : 'text-gray-500 hover:bg-white/80'
                }
              `}
            >
              <span
                className={`material-symbols-outlined text-[16px] ${isActive ? '' : cat.colorClass}`}
              >
                {cat.icon}
              </span>
              <span>{cat.label}</span>
            </button>
          )
        })}
      </div>

      {/* Response content */}
      <div className="space-y-2">
        <div className="flex justify-between items-end">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            回應內容
          </label>
          <button className="text-xs text-primary hover:text-primary-hover font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">
              auto_fix_high
            </span>{' '}
            AI 修飾
          </button>
        </div>
        <textarea
          value={responseText}
          onChange={(e) => handleTextChange(e.target.value)}
          className="w-full h-44 p-3 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary resize-none leading-relaxed"
          placeholder="在此撰寫您的查核回應..."
        />
        <div className="text-right">
          <span className="text-xs text-gray-400">{charCount} 字</span>
        </div>
      </div>

      {/* References */}
      <div className="space-y-2 flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">link</span>
            佐證資料
          </label>
          <button className="text-xs text-blue-600 hover:text-blue-700">
            從對話匯入
          </button>
        </div>
        <textarea
          value={references}
          onChange={(e) => setReferences(e.target.value)}
          className="w-full h-32 p-3 text-sm font-mono text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-primary focus:border-primary resize-none"
          placeholder="在此貼上連結或筆記..."
        />
      </div>
    </div>
  )
}
