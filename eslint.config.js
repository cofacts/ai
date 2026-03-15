//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    ignores: ['adk/.venv/**', 'adk/.adk/**'],
  },
]
