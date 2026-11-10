import { useEffect, useState } from 'react'
import { DocsContainer } from '@storybook/addon-docs/blocks'
import { GLOBALS_UPDATED } from 'storybook/internal/core-events'
import { themes } from 'storybook/theming'
import type { ComponentProps } from 'react'
import type { Decorator, Preview } from '@storybook/tanstack-react'

import '../src/styles/global.css'

// Mirrors how the app will switch themes: tokens flip on <html data-theme>. "system" removes
// the attribute so prefers-color-scheme decides.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as Theme
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  return Story()
}

type Theme = 'system' | 'light' | 'dark'
type DocsContext = ComponentProps<typeof DocsContainer>['context']

const prefersDark = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches

// The docs page chrome (background, text, tables) has its own Storybook theme, separate from our
// tokens. Follow the toolbar's theme global so the Docs page and the stories in it flip together.
function useThemeGlobal(context: DocsContext) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const story = context.getStoryContext(context.storyById())
      return story.globals.theme as Theme
    } catch {
      return 'light'
    }
  })
  useEffect(() => {
    const onUpdate = ({ userGlobals }: { userGlobals?: { theme?: Theme } }) => {
      if (userGlobals?.theme) setTheme(userGlobals.theme)
    }
    context.channel.on(GLOBALS_UPDATED, onUpdate)
    return () => context.channel.off(GLOBALS_UPDATED, onUpdate)
  }, [context])
  return theme
}

const ThemedDocsContainer = ({
  children,
  context,
}: ComponentProps<typeof DocsContainer>) => {
  const theme = useThemeGlobal(context)
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  return (
    <DocsContainer context={context} theme={dark ? themes.dark : themes.light}>
      {children}
    </DocsContainer>
  )
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color scheme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'system', title: 'System' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  // Autodocs: every component gets a Docs page that renders all its stories together.
  tags: ['autodocs'],
  decorators: [withTheme],
  parameters: {
    docs: { container: ThemedDocsContainer },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
