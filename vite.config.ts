import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart({
      router: {
        routeFileIgnorePattern: '__tests__',
      },
    }),
    viteReact(),
  ],
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // Enabled with `pnpm test --coverage`. cobertura.xml feeds the changed-lines
    // report in CI.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // Generated: TanStack Router, graphql-codegen, openapi-typescript, `pnpm tokens`.
        'src/routeTree.gen.ts',
        'src/server/gql/**',
        'src/**/*.d.ts',
        'src/styles/tokens.generated.ts',
        // shadcn primitives, and story files.
        'src/components/ui/**',
        'src/**/*.stories.tsx',
        'src/**/__tests__/**',
        // Router entrypoint.
        'src/router.tsx',
      ],
      reporter: ['text-summary', 'cobertura'],
    },
  },
})

export default config
