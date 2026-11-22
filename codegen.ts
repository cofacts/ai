import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: 'https://api.cofacts.tw/graphql',
  // Anywhere a server function may live: route files, *.functions.ts, *.server.ts.
  documents: [
    'src/**/*.{ts,tsx}',
    '!src/server/gql/**',
    '!src/**/__tests__/**',
  ],
  generates: {
    './src/server/gql/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
    },
  },
  ignoreNoDocuments: true,
  // `pnpm exec prettier --check .` covers src/server/gql, and codegen's own
  // output does not match our config — so format it here rather than leaving
  // every regeneration to fail lint until someone notices.
  hooks: {
    afterAllFileWrite: ['prettier --write'],
  },
}

export default config
