import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

// Vitest runs without the Start plugins. Start's compiler replaces every
// `createServerFn(...).handler(fn)` with an RPC stub and drops `fn`, so a route's
// server functions could not be tested; without it, tests mock `createServerFn`
// (src/test/createServerFnMock.ts) and call validator + handler directly.
const isVitest = !!process.env.VITEST

const config = defineConfig({
  plugins: [
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
    setupFiles: ['./vitest.setup.ts'],
  },
})

export default config
