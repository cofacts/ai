import { useCallback, useEffect, useRef, useState } from 'react'
import { ResponseEditor } from './ResponseEditor'
import { SourceLinkage } from './SourceLinkage'
import type { DrawerTab } from '@/routes/_app'
import type { SourceItem } from '@/lib/adk'

interface RightDrawerProps {
  isOpen: boolean
  onClose: () => void
  onOpen: () => void
  activeTab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
  draftResponse?: string
  onDraftChange?: (text: string) => void
  sources?: Array<SourceItem>
}

export function RightDrawer({
  isOpen,
  onClose,
  onOpen,
  activeTab,
  onTabChange,
  draftResponse,
  onDraftChange,
  sources = [],
}: RightDrawerProps) {
  return (
    <>
      {/* Desktop drawer */}
      <aside className="hidden md:flex w-[380px] bg-white border-l border-border-subtle flex-col shrink-0 shadow-lg z-10">
        <DrawerTabs activeTab={activeTab} onTabChange={onTabChange} />
        <DrawerContent
          activeTab={activeTab}
          draftResponse={draftResponse}
          onDraftChange={onDraftChange}
          sources={sources}
        />
        {activeTab === 'editor' && <SubmitButton />}
      </aside>

      {/* Mobile FAB */}
      <div className="fixed bottom-6 right-6 z-40 md:hidden">
        <button
          onClick={onOpen}
          className="bg-primary text-black font-medium py-3 px-6 rounded-full shadow-lg hover:bg-primary-hover transition-all flex items-center gap-2 active:scale-95"
        >
          <span className="material-symbols-outlined text-xl">edit_note</span>
          <span>編輯回應草稿</span>
          <span className="material-symbols-outlined text-sm">
            arrow_forward
          </span>
        </button>
      </div>

      {/* Mobile bottom sheet */}
      <MobileBottomSheet isOpen={isOpen} onClose={onClose}>
        <DrawerTabs activeTab={activeTab} onTabChange={onTabChange} />
        <DrawerContent
          activeTab={activeTab}
          draftResponse={draftResponse}
          onDraftChange={onDraftChange}
          sources={sources}
        />
        {activeTab === 'editor' && <SubmitButton />}
      </MobileBottomSheet>
    </>
  )
}

// ── Tab bar ──────────────────────────────────────────────────────

function DrawerTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
}) {
  return (
    <div className="flex border-b border-border-subtle bg-white shrink-0">
      <button
        onClick={() => onTabChange('editor')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'editor'
            ? 'border-b-2 border-primary text-primary bg-primary/5'
            : 'text-text-muted hover:text-text-main hover:bg-gray-50'
        }`}
      >
        回應編輯器
      </button>
      <button
        onClick={() => onTabChange('sources')}
        className={`flex-1 py-3 text-sm font-medium transition-colors ${
          activeTab === 'sources'
            ? 'border-b-2 border-primary text-primary bg-primary/5'
            : 'text-text-muted hover:text-text-main hover:bg-gray-50'
        }`}
      >
        資料關聯
      </button>
    </div>
  )
}

// ── Tab content ──────────────────────────────────────────────────

function DrawerContent({
  activeTab,
  draftResponse,
  onDraftChange,
  sources = [],
}: {
  activeTab: DrawerTab
  draftResponse?: string
  onDraftChange?: (text: string) => void
  sources?: Array<SourceItem>
}) {
  if (activeTab === 'editor') {
    return (
      <ResponseEditor
        draftResponse={draftResponse}
        onDraftChange={onDraftChange}
      />
    )
  }
  return <SourceLinkage sources={sources} />
}

// ── Submit button ────────────────────────────────────────────────

function SubmitButton() {
  return (
    <div className="p-4 bg-white border-t border-border-subtle shrink-0">
      <button className="w-full py-3 px-4 bg-primary text-black font-bold text-base rounded-lg hover:bg-primary-hover shadow-md transition-colors flex justify-center items-center gap-2">
        <span className="material-symbols-outlined">send</span>
        送進 Cofacts
      </button>
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
  const [sheetHeight, setSheetHeight] = useState(85) // vh
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
    // Snap to half or full, or close
    if (sheetHeight < 30) {
      onClose()
    } else if (sheetHeight < 60) {
      setSheetHeight(50)
    } else {
      setSheetHeight(85)
    }
    dragRef.current = null
  }, [sheetHeight, onClose])

  // Reset height when opened
  useEffect(() => {
    if (isOpen) setSheetHeight(85)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 w-full flex flex-col bg-[#F5F5F5] rounded-t-2xl bottom-sheet-shadow transition-[height] duration-100"
        style={{ height: `${sheetHeight}vh` }}
      >
        {/* Drag handle */}
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
