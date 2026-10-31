import type { Decorator, Preview } from '@storybook/tanstack-react'

import '../src/styles/global.css'

// Mirrors how the app will switch themes: tokens flip on <html data-theme>. "system" removes
// the attribute so prefers-color-scheme decides.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as 'system' | 'light' | 'dark'
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  return Story()
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
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
