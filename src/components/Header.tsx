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
    <header className="h-56 md:h-64 bg-base border-b border-subtle flex items-center justify-between px-16 shrink-0 z-30 relative shadow-btn">
      <div className="flex items-center gap-16 md:gap-24">
        {/* Mobile hamburger */}
        <button
          onClick={onToggleSidebar}
          className="p-8 -ml-8 text-secondary hover:text-primary md:hidden"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>

        {/* Logo */}
        <a className="flex items-center gap-8" href="/">
          <div className="w-32 h-32 bg-accent rounded-full flex items-center justify-center text-on-accent font-bold text-body-l">
            C
          </div>
          <span className="font-bold text-body-l md:text-heading-s text-primary">
            Cofacts
          </span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-24 text-body-s text-secondary">
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
      <div className="flex-1 max-w-xl mx-32 hidden lg:block">
        <div className="relative group">
          <span className="material-symbols-outlined absolute left-12 top-1/2 -translate-y-1/2 text-tertiary group-focus-within:text-primary">
            search
          </span>
          <input
            className="w-full bg-raised border-none rounded-full py-8 pl-40 pr-16 text-body-s focus:bg-base transition-all"
            placeholder="搜尋可疑訊息或查核報告..."
            type="text"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-12 md:gap-16">
        <button className="p-8 hover:bg-raised rounded-full text-secondary relative hidden md:block">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        {isLoading ? (
          <div className="w-32 h-32 md:w-36 md:h-36 rounded-full bg-selected overflow-hidden border border-subtle flex items-center justify-center">
            <span className="material-symbols-outlined text-tertiary">
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
                  className="rounded-full overflow-hidden cursor-pointer"
                />
              }
            >
              <UserAvatar user={user} size={36} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-224">
              <div className="flex items-center gap-12 px-12 py-10">
                <UserAvatar user={user} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-body-s text-primary truncate">
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
            className="px-16 py-6 rounded-full bg-accent text-on-accent text-body-s hover:bg-accent cursor-pointer"
          >
            登入 / 註冊
          </button>
        )}
      </div>
    </header>
  )
}
