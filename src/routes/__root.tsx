import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import appCss from '../styles.css?url'
import { AuthProvider } from '@/lib/auth'
import { getCurrentUserServerFn } from '@/server/me.functions'

export const Route = createRootRoute({
  loader: async () => ({ serverLoadedUser: await getCurrentUserServerFn() }),
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Cofacts.ai — AI-Assisted Citizen Fact-Checking',
      },
      {
        name: 'description',
        content:
          'Cofacts.ai is a conversational AI fact-checking collaboration platform, letting fact-checkers use AI assistance to check suspicious messages and draft responses.',
      },
      // Colours the Android toolbar once the app is installed; matches the
      // white Header the user sees directly below it.
      {
        name: 'theme-color',
        content: '#ffffff',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      // Without this link the manifest is never fetched, so the app is not
      // installable — and an uninstalled app cannot be a Web Share Target, no
      // matter what `share_target` says. public/manifest.json existed from the
      // project template but was never referenced by the document.
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'icon',
        href: '/icon.svg',
        type: 'image/svg+xml',
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
        sizes: '48x48',
      },
      {
        rel: 'apple-touch-icon',
        href: '/icon-192.png',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&display=swap',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap',
      },
    ],
  }),

  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { serverLoadedUser } = Route.useLoaderData()
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider serverLoadedUser={serverLoadedUser}>
          {children}
        </AuthProvider>
        <ReactQueryDevtools />
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return <Outlet />
}
