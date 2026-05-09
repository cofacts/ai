import { LoginPrompt } from './LoginPrompt'
import { WelcomeHero } from './WelcomeHero'

export function LoggedOutLanding() {
  return (
    <WelcomeHero>
      <LoginPrompt message="登入後即可開始使用 Cofacts.ai" />
    </WelcomeHero>
  )
}
