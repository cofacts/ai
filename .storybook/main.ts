import { materialSymbolsHref } from '../src/components/icons/material-symbols'
import type { StorybookConfig } from '@storybook/tanstack-react'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // `addon-vitest` runs every story (and its play function) as a Vitest test: the `storybook`
  // project in vite.config.ts.
  // pseudo-states: Penpot draws no hover or focus boards, so stories force :hover / :focus-visible
  // with `parameters.pseudo` to show them. a11y: axe checks in the Accessibility panel.
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-vitest',
    'storybook-addon-pseudo-states',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/tanstack-react',
    options: {},
  },
  // The deploy builds into public/storybook, inside Vite's default publicDir;
  // without this the app's public/ files are copied into the catalog.
  viteFinal: (viteConfig) => ({ ...viteConfig, publicDir: false }),
  // The same Material Symbols request as __root.tsx; the other fonts are in preview-head.html.
  previewHead: (head) =>
    `${head}\n<link rel="stylesheet" href="${materialSymbolsHref}" />`,
  // Deploys serve the catalog at /storybook/. Storybook loads its assets by
  // relative path, so /storybook (no slash) would render blank; send it to /storybook/.
  managerHead: (head, { configType }) =>
    configType === 'PRODUCTION'
      ? `<script>if (location.pathname === '/storybook') location.replace('/storybook/' + location.search + location.hash)</script>\n${head}`
      : head,
}

export default config
