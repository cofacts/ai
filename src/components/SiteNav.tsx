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
 * Mobile: logo, search, and a hamburger that opens the dark full menu.
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
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <header className="relative z-30 shrink-0">
      <div
        data-surface={menuOpen ? 'dark' : undefined}
        className={cn(
          'flex min-h-60 items-center gap-32 border-b px-20 py-12 md:min-h-64 md:px-48 md:py-16',
          menuOpen ? 'border-on-dark bg-dark' : 'border-subtle bg-base',
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
          <SearchForm onClose={() => setSearchOpen(false)} />
        ) : (
          <>
            <nav aria-label="主選單" className="hidden flex-1 md:block">
              <ul className="flex items-center gap-24">
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

            <div className="ml-auto flex items-center gap-8">
              <a
                href={NAV_LINKS.line.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: 'outline', withIcon: true }),
                  'hidden min-h-40 border-transparent bg-raised lg:inline-flex',
                )}
              >
                <LineMark />
                {NAV_LINKS.line.label}
              </a>
              <a
                href={NAV_LINKS.report.href}
                className={cn(
                  buttonVariants({ variant: 'primary', withIcon: true }),
                  'hidden min-h-40 md:inline-flex',
                )}
              >
                <Icon name="flag" />
                {NAV_LINKS.report.label}
              </a>
              <div className="hidden md:block">
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
                onClick={() => setSearchOpen(true)}
              />
              <Button
                ref={hamburgerRef}
                variant={menuOpen ? 'on-dark' : 'outline'}
                size="icon-touch"
                iconStart={menuOpen ? 'close' : 'menu'}
                aria-label={menuOpen ? '關閉選單' : '開啟選單'}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                className="md:hidden"
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
          className="absolute inset-x-0 top-full flex flex-col items-center gap-24 bg-dark px-64 pt-24 pb-32 md:hidden"
        >
          <ul className="flex flex-col items-center gap-24">
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
                  className="text-ui-m text-on-dark hover:underline aria-[current=page]:underline"
                >
                  {NAV_LINKS[key].label}
                </a>
              </li>
            ))}
            <li className="text-ui-m text-on-dark">LINE:@cofacts</li>
          </ul>
          <div className="flex w-full flex-col gap-8">
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
      className="group flex flex-col gap-2 text-ui-l whitespace-nowrap text-primary no-underline"
    >
      <span className="flex items-center gap-4">
        {label}
        {shown && (
          <span className="rounded-full bg-status-incorrect px-6 py-2 text-ui-xs text-on-status">
            <span aria-hidden="true">{shown}</span>
            <span className="sr-only">
              ，{count && count > 99 ? '99 則以上' : `${count} 則`}新訊息
            </span>
          </span>
        )}
      </span>
      <span className="h-2 w-full bg-transparent group-hover:bg-accent group-aria-[current=page]:bg-accent" />
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
        className="block size-40 rounded-full bg-raised"
        aria-hidden="true"
      />
    )
  }
  if (!user) {
    return (
      <Button
        variant="secondary"
        iconStart="account-circle"
        className="min-h-40"
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
      <DropdownMenuContent align="end" className="w-224">
        <div className="flex items-center gap-12 px-12 py-8">
          <UserAvatar user={user} size={40} />
          <span className="min-w-0 flex-1 truncate text-ui-m text-primary">
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
      className="flex flex-1 items-center gap-8"
    >
      <label className="relative flex-1">
        <span className="sr-only">搜尋</span>
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-12 -translate-y-1/2 text-icon-muted"
        />
        <input
          name="q"
          type="search"
          autoFocus
          placeholder="搜尋可疑訊息或查核報告..."
          className="min-h-36 w-full rounded-5 border-[0.5px] border-control bg-base py-8 pr-12 pl-40 text-ui-s text-primary placeholder:text-tertiary focus:border focus:border-accent"
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
      className="flex size-20 items-center justify-center rounded-5 bg-line text-on-line"
      aria-hidden="true"
    >
      <Icon name="line" size={16} />
    </span>
  )
}

export interface AiNavProps extends Pick<
  SiteNavProps,
  'user' | 'onLogin' | 'onLogout'
> {
  /** Mobile hamburger: opens the AI session sidebar. */
  onToggleSidebar: () => void
}

/**
 * Penpot Layout/Nav, Type = AI: the header of the Cofacts AI pages. Logo + 查核資料庫 / 協作區,
 * the search box, and the account control. On mobile the hamburger opens the session sidebar.
 */
export function AiNav({
  user,
  onLogin,
  onLogout,
  onToggleSidebar,
}: AiNavProps) {
  return (
    <header className="relative z-30 flex min-h-60 shrink-0 items-center gap-16 border-b border-subtle bg-base px-20 py-12 md:min-h-64 md:gap-48 md:px-48 md:py-16">
      <Button
        variant="outline"
        size="icon-touch"
        iconStart="side-navigation"
        aria-label="開啟對話列表"
        className="md:hidden"
        onClick={onToggleSidebar}
      />
      <a
        href="/"
        className="flex shrink-0 items-center gap-8"
        aria-label="Cofacts AI 首頁"
      >
        <Logo variant="icon" />
        <span className="text-heading-m text-primary" aria-hidden="true">
          Cofacts AI
        </span>
      </a>
      <nav aria-label="主選單" className="hidden md:block">
        <ul className="flex items-center gap-24">
          <li>
            <a
              href="https://cofacts.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-2 text-ui-l whitespace-nowrap text-primary no-underline"
            >
              查核資料庫
              <span className="h-2 w-full group-hover:bg-accent" />
            </a>
          </li>
          <li>
            <a
              href="/"
              aria-current="page"
              className="group flex flex-col gap-2 text-ui-l whitespace-nowrap text-primary no-underline"
            >
              協作區
              <span className="h-2 w-full bg-accent" />
            </a>
          </li>
        </ul>
      </nav>
      <form
        action={NAV_LINKS.search.href}
        role="search"
        className="relative hidden flex-1 lg:block"
      >
        <label>
          <span className="sr-only">搜尋</span>
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-12 -translate-y-1/2 text-icon-muted"
          />
          <input
            name="q"
            type="search"
            placeholder="搜尋可疑訊息或查核報告..."
            className="min-h-36 w-full rounded-5 border-[0.5px] border-control bg-base py-8 pr-12 pl-40 text-ui-s text-primary placeholder:text-tertiary focus:border focus:border-accent"
          />
        </label>
      </form>
      <div className="ml-auto">
        <AccountControl user={user} onLogin={onLogin} onLogout={onLogout} />
      </div>
    </header>
  )
}
