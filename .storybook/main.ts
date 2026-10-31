import type { StorybookConfig } from '@storybook/tanstack-react'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/tanstack-react',
    options: {},
  },
  // The deploy builds into public/storybook, inside Vite's default publicDir;
  // without this the app's public/ files are copied into the catalog.
  viteFinal: (viteConfig) => ({ ...viteConfig, publicDir: false }),
  // Deploys serve the catalog at /storybook/. Storybook loads its assets by
  // relative path, so /storybook (no slash) would render blank; send it to /storybook/.
  managerHead: (head, { configType }) =>
    configType === 'PRODUCTION'
      ? `<script>if (location.pathname === '/storybook') location.replace('/storybook/' + location.search + location.hash)</script>\n${head}`
      : head,
}

export default config
