import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: 'https://api.cofacts.tw/graphql',
  documents: ['src/server/**/*.ts', '!src/server/gql/**'],
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
