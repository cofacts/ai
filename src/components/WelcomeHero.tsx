interface WelcomeHeroProps {
  children?: React.ReactNode
}

export function WelcomeHero({ children }: WelcomeHeroProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center space-y-6">
        <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center text-white font-bold text-2xl mx-auto shadow-lg">
          C
        </div>
        <h1 className="text-2xl font-bold text-text-main">
          歡迎使用 Cofacts.ai
        </h1>
        <p className="text-text-muted leading-relaxed">
          貼上可疑訊息或 Cofacts 文章連結，AI 協助您進行查核、撰寫回應。
        </p>
      </div>

      {children && <div className="max-w-2xl w-full mt-8">{children}</div>}
    </div>
  )
}
