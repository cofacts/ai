import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: 'https://api.cofacts.tw/graphql',
  // Anywhere a server function may live: route files, *.functions.ts, *.server.ts.
  documents: ['src/**/*.{ts,tsx}', '!src/server/gql/**'],
  generates: {
    './src/server/gql/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
    },
  },
  ignoreNoDocuments: true,
}

export default config
