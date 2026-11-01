# Data layer: server to server

The browser never talks to rumors-api and never contains GraphQL. rumors-api will be protected
by a secret (Cloudflare token) and accept server-to-server requests only. Data reaches the UI
through TanStack Start server functions and the TanStack Query cache.

## Where things go

| What                                                           | Where                                                               | Who may import it                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| Server-only utilities: `cofactsExec`, the secret, JWT handling | `*.server.ts`                                                       | Only inside server-function handlers |
| GraphQL document                                               | Inline in the handler (`graphql()`), moves with its server function | Only inside handlers                 |
| Server function (`createServerFn`)                             | Inline in the route file, at module top level                       | Anyone                               |
| Types, constants                                               | plain `.ts`                                                         | Anyone                               |

## Server functions

1. A server function used by one route lives **in the route file**. The Start compiler replaces
   every `createServerFn(...).handler(...)` with an RPC stub in the client build, and drops the
   `*.server` imports and `graphql()` strings only the handler used.
2. When the route file gets long, or several routes need it, move the **whole server function
   together with its `queryOptions` factory** out (never the query alone). A file of only server
   functions is named `*.functions.ts` — never `*.server.ts`, or the client can't import it.
3. **Loaders only call server functions.** Loaders are isomorphic: on client navigation they run
   in the browser.
4. **`*.server` imports only inside handlers.** Used anywhere else, the import survives into the
   client bundle. Import protection warns in dev and **fails `pnpm build`**. Treat the dev
   warning as an error.
5. The secret is read only in `src/server/cofacts.server.ts`. Import protection can't catch a
   hard-coded string or `process.env` read in a plain file.
6. Type every server-function input with `.inputValidator`, and check there whatever a caller
   could get wrong (an allowed value, a range), throwing on bad input. Return only fields the
   UI needs: the result is serialized into the HTML.

## Reading data: TanStack Query

1. **Data goes into the TanStack Query cache.** `setupRouterSsrQueryIntegration` serializes the
   cache filled during SSR into the page; the browser hydrates it without refetching. One
   `QueryClient` per request (`getRouter()`).
2. **Needed in the SSR HTML → `useSuspenseQuery`.** Client-only (AI session list, "my feedback")
   → `useQuery`. `useEffect` and plain `useQuery` never run during SSR.
3. **Every route awaits the queries its SSR HTML needs in its loader**
   (`await context.queryClient.ensureQueryData(...)`), even when `head()` needs nothing. A
   failure then reaches the router: HTTP 500 and the error component, inside the site nav.
   With only `useSuspenseQuery`, a failed SSR query falls back to the root Suspense boundary
   and the response is **HTTP 200 with an empty `<body>`**. The loader returns only what
   `head()` needs (often nothing): loader data is serialized too, so returning the whole result
   duplicates the cache. Page content always reads the cache, never `useLoaderData()`. Throw
   `notFound()` / `redirect()` from the loader to get the right status code.
4. **Writes:** `useMutation` calling a server function, then `invalidateQueries` on the key.
5. **`queryKey = [GraphQL operation name, variables]`**: `['GetArticle', id]`; objects for several
   params: `['ListArticles', filter]`. Operation names are unique (codegen enforces it), so
   routes can't overwrite each other's cache. A `queryOptions` factory (`articleQuery(id)`)
   bundles key + `queryFn` and works for both `ensureQueryData` and the hooks; it is **the** way
   to share data access. Per-user queries are removed from the cache on logout.
6. **Set `staleTime` per query**, greater than 0 (otherwise the browser refetches right after SSR).
7. Data the page can render without (a sidebar widget, below-the-fold extras) uses `useQuery`
   or a nested Suspense boundary instead, so its failure doesn't fail the page. To start it
   early, call `ensureQueryData` in the loader without `await`.

Route setup (once): `createRouter({ context: { queryClient } })` and
`createRootRouteWithContext<{ queryClient: QueryClient }>()`.

## Example

```tsx
// src/routes/article.$id/index.tsx
import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { cofactsExec } from '@/server/cofacts.server'
import { graphql } from '@/server/gql'
import { ArticlePageView } from './-components/ArticlePageView'

const getArticle = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(({ data: id }) =>
    cofactsExec(
      graphql(`
        query GetArticle($id: String!) {
          GetArticle(id: $id) {
            id
            text
            createdAt
            articleReplies(status: NORMAL) {
              reply {
                id
                type
                text
                reference
              }
            }
          }
        }
      `),
      { id },
    ),
  )

const articleQuery = (id: string) =>
  queryOptions({
    queryKey: ['GetArticle', id],
    queryFn: () => getArticle({ data: id }),
    staleTime: 60_000,
  })

export const Route = createFileRoute('/article/$id/')({
  // Await what the SSR HTML needs; return only what head() needs.
  loader: async ({ context, params }) => {
    const { GetArticle: article } = await context.queryClient.ensureQueryData(
      articleQuery(params.id),
    )
    if (!article) throw notFound()
    return { title: article.text.slice(0, 60) } // only what head() needs
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData.title} | Cofacts` }],
  }),
  component: ArticlePage,
})

function ArticlePage() {
  const { id } = Route.useParams()
  const { data } = useSuspenseQuery(articleQuery(id)) // reads the cache the loader filled
  return <ArticlePageView article={data.GetArticle!} />
}
```

## Components

Shared components and `-components/` take typed props; only route components call query hooks.
Writes reach components as callbacks (`onSubmit`, `onLoadMore`). Stories feed fixtures and `fn()`.

## SSR is the logged-in view

Server functions read the session cookie, so SSR renders the logged-in page. The CDN must not
cache responses that carry `cofacts_session`, and those responses send `Cache-Control: private,
no-store`.
