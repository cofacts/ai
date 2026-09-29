import { LoginPrompt } from './LoginPrompt'
import { WelcomeHero } from './WelcomeHero'

export function LoggedOutLanding() {
  return (
    <WelcomeHero>
      <LoginPrompt message="Sign in to start using Cofacts.ai" />
    </WelcomeHero>
  )
}
