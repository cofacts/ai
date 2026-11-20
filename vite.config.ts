import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import type { Plugin } from 'vite'

// Vitest runs without the Start plugins. Start's compiler replaces every
// `createServerFn(...).handler(fn)` with an RPC stub and drops `fn`, so a route's
// server functions could not be tested; without it, tests mock `createServerFn`
// (src/test/createServerFnMock.ts) and call validator + handler directly.
const isVitest = !!process.env.VITEST

/**
 * `import data from './file?base64'` gives the file's bytes as a base64 string, so a
 * binary the server reads (the og.png fonts, resvg's wasm) ships inside the server
 * bundle: no Nitro asset config and nothing to read from disk at runtime. Vite's own
 * `?inline` doesn't take .wasm.
 */
function base64Import(): Plugin {
  const SUFFIX = '?base64'
  return {
    name: 'cofacts:base64-import',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null
      const resolved = await this.resolve(
        source.slice(0, -SUFFIX.length),
        importer,
        {
          skipSelf: true,
        },
      )
      return resolved && `${resolved.id}${SUFFIX}`
    },
    load(id) {
      if (!id.endsWith(SUFFIX)) return null
      const file = id.slice(0, -SUFFIX.length)
      this.addWatchFile(file)
      return `export default ${JSON.stringify(fs.readFileSync(file).toString('base64'))}`
    },
  }
}

const config = defineConfig({
  plugins: [
    base64Import(),
    !isVitest && devtools(),
    !isVitest && nitro(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
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
        // The app's server plugins (TanStack Start, Nitro, devtools) aren't needed to render a
        // story; these three are what the components need.
        plugins: [
          viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
          tailwindcss(),
          viteReact(),
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
            provider: 'playwright',
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
