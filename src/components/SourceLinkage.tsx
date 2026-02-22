import type { SourceItem } from '@/lib/adk'

interface SourceLinkageProps {
  sources: Array<SourceItem>
}

// Placeholder sources for UI development
const placeholderSources: Array<SourceItem> = [
  {
    url: 'https://tfc-taiwan.org.tw/articles/1234',
    title: '【錯誤】網傳政府補助電動機車2萬元？',
    domain: 'tfc-taiwan.org.tw',
    snippet:
      '經查核，網傳訊息引用的數據過時，且混淆了地方政府與中央單位的補助方案。目前並無單筆2萬元的現金...',
    adopted: true,
    faviconUrl: undefined,
    thumbnailUrl: undefined,
  },
  {
    url: 'https://www.mygopen.com/2023/12/scam-link.html',
    title: '【詐騙】LINE 轉傳補助連結？小心個資外流',
    domain: 'mygopen.com',
    snippet:
      '近期詐騙集團利用補助名義發送釣魚簡訊與LINE訊息，連結網址並非政府gov.tw結尾，請民眾務必...',
    adopted: false,
    faviconUrl: undefined,
    thumbnailUrl: undefined,
  },
  {
    url: 'https://www.ida.gov.tw/subsidy',
    title: '經濟部工業局電動機車補助說明',
    domain: 'ida.gov.tw',
    snippet:
      '112年度電動機車產業補助實施要點公告，針對重型、輕型等級不同，補助金額分別為7000元...',
    adopted: true,
    faviconUrl: undefined,
    thumbnailUrl: undefined,
  },
]

export function SourceLinkage({ sources }: SourceLinkageProps) {
  const displaySources = sources.length > 0 ? sources : placeholderSources

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-1 px-1">
        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
          相關來源 ({displaySources.length})
        </h3>
        <button className="text-[11px] text-primary hover:text-primary-hover font-bold tracking-tight">
          重新搜尋
        </button>
      </div>

      {/* Source cards */}
      {displaySources.map((source, index) => (
        <a
          key={index}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer block"
        >
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              {/* Domain */}
              <div className="flex items-center gap-2 mb-2">
                {source.faviconUrl ? (
                  <img
                    alt="Favicon"
                    className="w-4 h-4 rounded-sm"
                    src={source.faviconUrl}
                  />
                ) : (
                  <span className="material-symbols-outlined text-[14px] text-gray-400">
                    language
                  </span>
                )}
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide truncate">
                  {source.domain}
                </span>
              </div>

              {/* Title */}
              <h4 className="font-bold text-gray-900 text-[13px] mb-2 leading-snug">
                {source.title}
              </h4>

              {/* Snippet */}
              <p className="text-[12px] text-gray-500 line-clamp-2 leading-relaxed">
                {source.snippet}
              </p>
            </div>

            {/* Thumbnail */}
            {source.thumbnailUrl ? (
              <div className="w-16 h-16 flex-shrink-0 bg-gray-50 rounded-lg overflow-hidden border border-gray-100">
                <img
                  alt="Thumbnail"
                  className="w-full h-full object-cover"
                  src={source.thumbnailUrl}
                />
              </div>
            ) : (
              <div className="w-16 h-16 flex-shrink-0 bg-gray-50 rounded-lg flex items-center justify-center border border-gray-100">
                <span className="material-symbols-outlined text-gray-300">
                  article
                </span>
              </div>
            )}
          </div>

          {/* Adopted badge */}
          {source.adopted && (
            <div className="mt-3 flex items-center">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-600 border border-green-100">
                <span className="material-symbols-outlined text-[12px] mr-1">
                  check_circle
                </span>
                已採用
              </span>
            </div>
          )}
        </a>
      ))}
    </div>
  )
}
