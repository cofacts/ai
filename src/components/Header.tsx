import { LogOutIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { UserAvatar } from '@/components/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'

interface HeaderProps {
  onToggleSidebar: () => void
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { user, isLoading, login, logout } = useAuth()

  return (
    <header className="h-[56px] md:h-spacing-64 bg-surface-base border-b border-border-subtle flex items-center justify-between px-spacing-16 shrink-0 z-30 relative shadow-btn-shadow">
      <div className="flex items-center gap-spacing-16 md:gap-spacing-24">
        {/* Mobile hamburger */}
        <button
          onClick={onToggleSidebar}
          className="p-spacing-8 -ml-spacing-8 text-text-secondary hover:text-text-primary md:hidden"
        >
          <Icon name="menu" size={24} />
        </button>

        {/* Logo */}
        <a className="flex items-center gap-spacing-8" href="/">
          <div className="w-spacing-32 h-spacing-32 bg-surface-accent rounded-full flex items-center justify-center text-text-on-accent font-bold text-type-body-l">
            C
          </div>
          <span className="font-bold text-type-body-l md:text-type-heading-s text-text-primary">
            Cofacts
          </span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-spacing-24 text-type-body-s text-text-secondary">
          <a
            className="hover:text-text-primary transition-colors"
            href="https://cofacts.tw"
            target="_blank"
            rel="noopener noreferrer"
          >
            查核資料庫
          </a>
          <a className="hover:text-text-primary transition-colors" href="/">
            協作區
          </a>
        </nav>
      </div>

      {/* Desktop search bar */}
      <div className="flex-1 max-w-xl mx-spacing-32 hidden lg:block">
        <div className="relative group">
          <Icon
            name="search"
            size={24}
            className="absolute left-spacing-12 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-text-primary"
          />
          <input
            className="w-full bg-surface-raised border-none rounded-full py-spacing-8 pl-[40px] pr-spacing-16 text-type-body-s focus:bg-surface-base transition-all"
            placeholder="搜尋可疑訊息或查核報告..."
            type="text"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-spacing-12 md:gap-spacing-16">
        <button className="p-spacing-8 hover:bg-surface-raised rounded-full text-text-secondary relative hidden md:block">
          <Icon name="notifications" size={24} />
        </button>
        {isLoading ? (
          <div className="w-spacing-32 h-spacing-32 md:w-[36px] md:h-[36px] rounded-full bg-surface-selected overflow-hidden border border-border-subtle flex items-center justify-center">
            <Icon name="person" size={24} className="text-text-tertiary" />
          </div>
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={user.name ?? ''}
                  className="rounded-full overflow-hidden cursor-pointer"
                />
              }
            >
              <UserAvatar user={user} size={36} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[224px]">
              <div className="flex items-center gap-spacing-12 px-spacing-12 py-[10px]">
                <UserAvatar user={user} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-type-body-s text-text-primary truncate">
                    {user.name}
                  </div>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}>
                <LogOutIcon />
                登出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={() => login()}
            className="px-spacing-16 py-[6px] rounded-full bg-surface-accent text-text-on-accent text-type-body-s hover:bg-surface-accent-subtle cursor-pointer"
          >
            登入 / 註冊
          </button>
        )}
      </div>
    </header>
  )
}
