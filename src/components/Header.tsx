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

interface HeaderProps {
  onToggleSidebar: () => void
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const { user, isLoading, login, logout } = useAuth()

  return (
    <header className="h-14 md:h-16 bg-white border-b border-border-subtle flex items-center justify-between px-4 shrink-0 z-30 relative shadow-sm">
      <div className="flex items-center gap-4 md:gap-6">
        {/* Mobile hamburger */}
        <button
          onClick={onToggleSidebar}
          className="p-2 -ml-2 text-text-muted hover:text-text-main md:hidden"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>

        {/* Logo */}
        <a className="flex items-center gap-2" href="/">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-bold text-lg">
            C
          </div>
          <span className="font-bold text-lg md:text-xl tracking-tight text-text-main">
            Cofacts
          </span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-text-muted">
          <a
            className="hover:text-primary transition-colors"
            href="https://cofacts.tw"
            target="_blank"
            rel="noopener noreferrer"
          >
            查核資料庫
          </a>
          <a className="hover:text-primary transition-colors" href="/">
            協作區
          </a>
        </nav>
      </div>

      {/* Desktop search bar */}
      <div className="flex-1 max-w-xl mx-8 hidden lg:block">
        <div className="relative group">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary">
            search
          </span>
          <input
            className="w-full bg-gray-100 border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary focus:bg-white transition-all"
            placeholder="搜尋可疑訊息或查核報告..."
            type="text"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3 md:gap-4">
        <button className="p-2 hover:bg-gray-100 rounded-full text-text-muted relative hidden md:block">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        {isLoading ? (
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-gray-200 overflow-hidden border border-gray-300 flex items-center justify-center">
            <span className="material-symbols-outlined text-gray-500">
              person
            </span>
          </div>
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={user.name ?? ''}
                  className="rounded-full overflow-hidden cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary"
                />
              }
            >
              <UserAvatar user={user} size={36} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <UserAvatar user={user} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-main truncate">
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
            className="px-4 py-1.5 rounded-full bg-primary text-white text-sm font-medium hover:bg-primary/90 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            登入 / 註冊
          </button>
        )}
      </div>
    </header>
  )
}
