import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Vitest runs without the Start plugins. Start's compiler replaces every
// `createServerFn(...).handler(fn)` with an RPC stub and drops `fn`, so a route's
// server functions could not be tested; without it, tests mock `createServerFn`
// (src/test/createServerFnMock.ts) and call validator + handler directly.
const isVitest = !!process.env.VITEST

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    !isVitest && devtools(),
    !isVitest && nitro(),
    tailwindcss(),
    !isVitest &&
      tanstackStart({
        router: {
          routeFileIgnorePattern: '__tests__',
        },
      }),
    viteReact(),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', setupFiles: ['./vitest.setup.ts'] },
      },
      // Every story renders in Chromium and runs its play function; a story that throws or a
      // play function whose expect() fails is a failing test.
      {
        // Shares the root plugins, which under Vitest are only Tailwind and React (see isVitest).
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              '.storybook',
            ),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
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
