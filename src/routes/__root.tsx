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
        title: 'Cofacts.ai — AI 協助公民查核',
      },
      {
        name: 'description',
        content:
          'Cofacts.ai 是一個對話式 AI 查核協作平台，讓查核協作者可以透過 AI 輔助來查核可疑訊息、撰寫回應。',
      },
      // Paints the Android status bar to match the header once installed.
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
      // Without this link the manifest is never fetched, the app is not
      // installable, and Android's share sheet never lists it — which makes the
      // share_target inside it dead weight. It existed in public/ all along,
      // unreferenced.
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/icon.svg',
      },
      // Browsers request /favicon.ico by convention whether or not it is linked;
      // linking it makes the intent visible next to the others.
      {
        rel: 'icon',
        sizes: '48x48',
        href: '/favicon.ico',
      },
      {
        rel: 'apple-touch-icon',
        href: '/icon-192.png',
      },
    ],
  }),

  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { serverLoadedUser } = Route.useLoaderData()
  return (
    <html lang="zh-TW">
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
