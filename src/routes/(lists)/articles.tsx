import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'

import { graphql } from '@/server/gql'
import { cofactsExec } from '@/server/cofacts.server'

/**
 * /articles — 可疑訊息. For now it only proves the data path end to end: a server function
 * calls rumors-api, the result lands in the TanStack Query cache during SSR, and the page
 * prints it. The list UI (Penpot `Doubious Message-1440`) comes in Track 1.
 */

const listArticles = createServerFn({ method: 'GET' }).handler(() =>
  cofactsExec(
    graphql(`
      query ListArticles {
        ListArticles(first: 10, orderBy: [{ lastRequestedAt: DESC }]) {
          totalCount
          edges {
            node {
              id
              text
              articleType
              createdAt
              replyRequestCount
              articleReplies(status: NORMAL) {
                replyType
              }
            }
          }
        }
      }
    `),
  ),
)

// queryKey = [GraphQL operation name, variables]; key and queryFn live together.
const articlesQuery = queryOptions({
  queryKey: ['ListArticles'],
  queryFn: () => listArticles(),
  staleTime: 60_000,
})

export const Route = createFileRoute('/(lists)/articles')({
  // Awaited so a failed query reaches the router (500 + error component) instead of an empty
  // 200. Nothing is returned: head() needs no data, and the page reads the cache.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(articlesQuery)
  },
  head: () => ({
    meta: [
      { title: '可疑訊息 | Cofacts 真的假的' },
      {
        name: 'description',
        content:
          'Cofacts 真的假的：網友回報的可疑訊息，以及志工編輯的查核回應。',
      },
    ],
  }),
  component: ArticlesPage,
})

function ArticlesPage() {
  const { data } = useSuspenseQuery(articlesQuery)
  return (
    <main className="mx-auto flex w-full max-w-[1136px] flex-1 flex-col gap-spacing-16 px-spacing-20 py-spacing-32 lg:px-spacing-48">
      <h1 className="text-type-heading-l text-text-primary">可疑訊息</h1>
      <p className="text-type-body-m text-text-secondary">
        共 {data.ListArticles?.totalCount ?? 0} 則。以下是 server function
        載入的原始資料。
      </p>
      <pre className="overflow-x-auto rounded-radius-5 bg-surface-raised p-spacing-16 font-mono text-type-caption text-text-primary">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  )
}
