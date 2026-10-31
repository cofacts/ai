interface WelcomeHeroProps {
  children?: React.ReactNode
}

export function WelcomeHero({ children }: WelcomeHeroProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-spacing-24">
      <div className="max-w-2xl w-full text-center space-y-spacing-24">
        <div className="w-spacing-64 h-spacing-64 bg-surface-accent rounded-full flex items-center justify-center text-text-on-accent font-bold text-type-heading-m mx-auto shadow-btn-shadow">
          C
        </div>
        <h1 className="text-type-heading-m font-bold text-text-primary">
          歡迎使用 Cofacts.ai
        </h1>
        <p className="text-text-secondary">
          貼上可疑訊息或 Cofacts 文章連結，AI 協助您進行查核、撰寫回應。
        </p>
      </div>

      {children && (
        <div className="max-w-2xl w-full mt-spacing-32">{children}</div>
      )}
    </div>
  )
}
