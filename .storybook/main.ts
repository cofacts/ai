import type { StorybookConfig } from '@storybook/tanstack-react'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/tanstack-react',
    options: {},
  },
}

export default config
