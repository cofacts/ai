import { useEffect, useId, useRef, useState } from 'react'

import type { CofactsUser } from '@/lib/auth'
import { Logo } from '@/components/Logo'
import { UserAvatar } from '@/components/UserAvatar'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

/**
 * Where the nav links point. Pages not yet migrated to this app still go to cofacts.tw; switch
 * each to its local path when its route lands (kb doc §2.2).
 */
export const NAV_LINKS = {
  articles: { label: '可疑訊息', href: '/articles' },
  replies: { label: '最新查核', href: 'https://cofacts.tw/replies' },
  hoaxForYou: { label: '等你來答', href: 'https://cofacts.tw/hoax-for-you' },
  ai: { label: '問問 AI', href: '/' },
  tutorial: { label: '使用教學', href: 'https://cofacts.tw/tutorial' },
  about: { label: '關於', href: 'https://cofacts.tw/about' },
  contact: { label: '聯絡我們', href: 'mailto:cofacts@googlegroups.com' },
  report: { label: '回報可疑訊息', href: 'https://cofacts.tw/report' },
  line: { label: '加LINE查謠言', href: 'https://line.me/R/ti/p/@cofacts' },
  search: { href: 'https://cofacts.tw/search' },
} as const

type NavKey = 'articles' | 'replies' | 'hoaxForYou' | 'ai' | 'tutorial'
const MAIN_ITEMS: ReadonlyArray<NavKey> = [
  'articles',
  'replies',
  'hoaxForYou',
  'ai',
  'tutorial',
]

export type SiteNavUser = Pick<
  CofactsUser,
  'name' | 'avatarUrl' | 'avatarType' | 'avatarData'
>

export interface SiteNavProps {
  /** The page this nav is on; that item gets `aria-current="page"` and the underline. */
  current?: NavKey
  /** `undefined` while the session is loading. */
  user: SiteNavUser | null | undefined
  /** Number of new fact-checks, shown as a badge on 最新查核 (99+ above 99). */
  newReplyCount?: number
  onLogin: () => void
  onLogout: () => void
}

/**
 * Penpot Layout/Nav (Type = Default / login / search) and Nav-Mobile / Nav-MobileExpanded.
 * Desktop: logo, main links, then LINE · 回報可疑訊息 · login (or the avatar menu) · search.
 * Mobile (below lg, 1024px; the desktop row needs about 940px): logo, search, and a hamburger
 * that opens the dark full menu.
 */
export function SiteNav({
  current,
  user,
  newReplyCount,
  onLogin,
  onLogout,
}: SiteNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const menuId = useId()
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)

  // Mobile menu: focus the first item on open; Esc closes and returns focus (a11y guide 06).
  useEffect(() => {
    if (!menuOpen) return
    firstItemRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      hamburgerRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    // The menu exists only below lg; widening the window (or rotating a tablet) closes it,
    // otherwise the bar would stay dark with dark links.
    const desktop = window.matchMedia('(min-width: 64rem)')
    const onWiden = () => desktop.matches && setMenuOpen(false)
    desktop.addEventListener('change', onWiden)
    return () => {
      window.removeEventListener('keydown', onKey)
      desktop.removeEventListener('change', onWiden)
    }
  }, [menuOpen])

  const closeSearch = () => {
    setSearchOpen(false)
    // The search button is back once the form unmounts; return focus to it (a11y guide 06).
    requestAnimationFrame(() => searchButtonRef.current?.focus())
  }

  return (
    <header className="relative z-30 shrink-0">
      <div
        data-surface={menuOpen ? 'dark' : undefined}
        className={cn(
          'flex min-h-[60px] items-center gap-spacing-32 border-b px-spacing-20 py-spacing-12 lg:min-h-spacing-64 lg:px-spacing-48 lg:py-spacing-16',
          menuOpen
            ? 'border-border-on-dark bg-surface-dark'
            : 'border-border-subtle bg-surface-base',
        )}
      >
        <a
          href="/"
          className="flex shrink-0 items-center"
          aria-label="Cofacts 真的假的 首頁"
        >
          <Logo onDark={menuOpen} />
        </a>

        {searchOpen ? (
          <SearchForm onClose={closeSearch} />
        ) : (
          <>
            <nav aria-label="主選單" className="hidden flex-1 lg:block">
              <ul className="flex items-center gap-spacing-24">
                {MAIN_ITEMS.map((key) => (
                  <li key={key}>
                    <NavItem
                      navKey={key}
                      current={current === key}
                      count={key === 'replies' ? newReplyCount : undefined}
                    />
                  </li>
                ))}
              </ul>
            </nav>

            <div className="ml-auto flex items-center gap-spacing-8">
              <a
                href={NAV_LINKS.line.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: 'outline', withIcon: true }),
                  'hidden min-h-[40px] border-transparent bg-surface-raised xl:inline-flex',
                )}
              >
                <LineMark />
                {NAV_LINKS.line.label}
              </a>
              <a
                href={NAV_LINKS.report.href}
                className={cn(
                  buttonVariants({ variant: 'primary', withIcon: true }),
                  'hidden min-h-[40px] lg:inline-flex',
                )}
              >
                <Icon name="flag" />
                {NAV_LINKS.report.label}
              </a>
              <div className="hidden lg:block">
                <AccountControl
                  user={user}
                  onLogin={onLogin}
                  onLogout={onLogout}
                />
              </div>
              <Button
                variant={menuOpen ? 'on-dark' : 'outline'}
                size="icon-touch"
                iconStart="search"
                aria-label="搜尋"
                className="border-transparent"
                ref={searchButtonRef}
                onClick={() => {
                  setMenuOpen(false)
                  setSearchOpen(true)
                }}
              />
              <Button
                ref={hamburgerRef}
                variant={menuOpen ? 'on-dark' : 'outline'}
                size="icon-touch"
                iconStart={menuOpen ? 'close' : 'menu'}
                aria-label={menuOpen ? '關閉選單' : '開啟選單'}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                className="lg:hidden"
                onClick={() => setMenuOpen((v) => !v)}
              />
            </div>
          </>
        )}
      </div>

      {menuOpen && (
        <nav
          id={menuId}
          aria-label="主選單"
          data-surface="dark"
          className="absolute inset-x-0 top-full flex flex-col items-center gap-spacing-24 bg-surface-dark px-spacing-64 pt-spacing-24 pb-spacing-32 lg:hidden"
        >
          <ul className="flex flex-col items-center gap-spacing-24">
            {(
              [
                'articles',
                'replies',
                'hoaxForYou',
                'ai',
                'tutorial',
                'about',
                'contact',
              ] as const
            ).map((key, i) => (
              <li key={key}>
                <a
                  ref={i === 0 ? firstItemRef : undefined}
                  href={NAV_LINKS[key].href}
                  aria-current={current === key ? 'page' : undefined}
                  className="text-type-ui-m text-text-on-dark hover:underline aria-[current=page]:underline"
                >
                  {NAV_LINKS[key].label}
                </a>
              </li>
            ))}
            <li className="text-type-ui-m text-text-on-dark">LINE:@cofacts</li>
          </ul>
          <div className="flex w-full flex-col gap-spacing-8">
            <a
              href={NAV_LINKS.report.href}
              className={cn(
                buttonVariants({ size: 'lg', withIcon: true }),
                'w-full',
              )}
            >
              <Icon name="flag" />
              {NAV_LINKS.report.label}
            </a>
            <a
              href={NAV_LINKS.line.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: 'line', size: 'lg', withIcon: true }),
                'w-full',
              )}
            >
              <Icon name="line" size={22} />
              {NAV_LINKS.line.label}
            </a>
            {user ? (
              <Button
                variant="on-dark"
                size="lg"
                className="w-full"
                onClick={onLogout}
              >
                登出
              </Button>
            ) : (
              <Button
                variant="on-dark"
                size="lg"
                className="w-full"
                onClick={onLogin}
              >
                登入
              </Button>
            )}
          </div>
        </nav>
      )}
    </header>
  )
}

/** Penpot Layout/NavItem: ui-l text; the current page and hover get a 2px yellow underline. */
function NavItem({
  navKey,
  current,
  count,
}: {
  navKey: NavKey
  current: boolean
  count?: number
}) {
  const { label, href } = NAV_LINKS[navKey]
  const shown = count && count > 0 ? (count > 99 ? '99+' : String(count)) : null
  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className="group flex flex-col gap-spacing-2 text-type-ui-l whitespace-nowrap text-text-primary no-underline"
    >
      <span className="flex items-center gap-spacing-4">
        {label}
        {shown && (
          <span className="rounded-full bg-status-incorrect px-[6px] py-spacing-2 text-type-ui-xs text-text-on-status">
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">
              ，{count && count > 99 ? '99 則以上' : `${count} 則`}新訊息
            </span>
          </span>
        )}
      </span>
      <span className="h-spacing-2 w-full bg-transparent group-hover:bg-surface-accent group-aria-[current=page]:bg-surface-accent" />
    </a>
  )
}

/** 登入 button, or the avatar with a menu once logged in. */
function AccountControl({
  user,
  onLogin,
  onLogout,
}: Pick<SiteNavProps, 'user' | 'onLogin' | 'onLogout'>) {
  if (user === undefined) {
    return (
      <span
        className="block size-[40px] rounded-full bg-surface-raised"
        aria-hidden="true"
      />
    )
  }
  if (!user) {
    return (
      <Button
        variant="secondary"
        iconStart="account-circle"
        className="min-h-[40px]"
        onClick={onLogin}
      >
        登入
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${user.name ?? ''} 的帳號選單`}
            className="rounded-full"
          />
        }
      >
        <UserAvatar user={user} size={40} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[224px]">
        <div className="flex items-center gap-spacing-12 px-spacing-12 py-spacing-8">
          <UserAvatar user={user} size={40} />
          <span className="min-w-0 flex-1 truncate text-type-ui-m text-text-primary">
            {user.name}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout}>登出</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Penpot Nav Type = search: the input replaces the links. Submits to the search page. */
function SearchForm({ onClose }: { onClose: () => void }) {
  return (
    <form
      action={NAV_LINKS.search.href}
      role="search"
      className="flex flex-1 items-center gap-spacing-8"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <label className="relative flex-1">
        <span className="sr-only">搜尋</span>
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-spacing-12 -translate-y-1/2 text-icon-muted"
        />
        <input
          name="q"
          type="search"
          autoFocus
          placeholder="搜尋可疑訊息或查核報告..."
          className="min-h-[36px] w-full rounded-radius-5 border-[0.5px] border-border-control bg-surface-base py-spacing-8 pr-spacing-12 pl-[40px] text-type-ui-s text-text-primary placeholder:text-text-tertiary focus:border focus:border-border-accent"
        />
      </label>
      <Button
        variant="outline"
        size="icon-touch"
        iconStart="close"
        aria-label="關閉搜尋"
        onClick={onClose}
      />
    </form>
  )
}

/** The LINE logo inside a green rounded square (Penpot uses the LINE app icon image here). */
function LineMark() {
  return (
    <span
      className="flex size-spacing-20 items-center justify-center rounded-radius-5 bg-surface-line text-text-on-line"
      aria-hidden="true"
    >
      <Icon name="line" size={16} />
    </span>
  )
}
