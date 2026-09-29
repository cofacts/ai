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
          Welcome to Cofacts.ai
        </h1>
        <p className="text-text-muted leading-relaxed">
          Paste a suspicious message or a Cofacts article link, and AI will help
          you fact-check it and draft a response.
        </p>
      </div>

      {children && <div className="max-w-2xl w-full mt-8">{children}</div>}
    </div>
  )
}
