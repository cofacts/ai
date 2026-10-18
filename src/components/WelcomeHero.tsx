interface WelcomeHeroProps {
  children?: React.ReactNode
}

export function WelcomeHero({ children }: WelcomeHeroProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-24">
      <div className="max-w-2xl w-full text-center space-y-24">
        <div className="w-64 h-64 bg-accent rounded-full flex items-center justify-center text-on-accent font-bold text-heading-m mx-auto shadow-btn">
          C
        </div>
        <h1 className="text-heading-m font-bold text-primary">
          歡迎使用 Cofacts.ai
        </h1>
        <p className="text-secondary">
          貼上可疑訊息或 Cofacts 文章連結，AI 協助您進行查核、撰寫回應。
        </p>
      </div>

      {children && <div className="max-w-2xl w-full mt-32">{children}</div>}
    </div>
  )
}
