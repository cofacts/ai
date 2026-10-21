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
  // No loader: head() doesn't need data and the page always exists. useSuspenseQuery below
  // runs during SSR, so the data is still in the server-rendered HTML.
  head: () => ({ meta: [{ title: '可疑訊息 | Cofacts 真的假的' }] }),
  component: ArticlesPage,
})

function ArticlesPage() {
  const { data } = useSuspenseQuery(articlesQuery)
  return (
    <main className="mx-auto flex w-full max-w-1040 flex-1 flex-col gap-16 px-20 py-32 md:px-0">
      <h1 className="text-heading-l text-primary">可疑訊息</h1>
      <p className="text-body-m text-secondary">
        共 {data.ListArticles?.totalCount ?? 0} 則。以下是 server function
        載入的原始資料。
      </p>
      <pre className="overflow-x-auto rounded-5 bg-raised p-16 font-mono text-caption text-primary">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  )
}
