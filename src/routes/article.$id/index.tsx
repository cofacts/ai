import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'

import { ArticleQuickNav } from './-components/ArticleQuickNav'
import { ArticleSection } from './-components/ArticleSection'
import {
  ARTICLE_SECTION_IDS,
  getArticleHead,
  getQuickNavItems,
  ogImageVersion,
  ogVerdict,
  replyAnchorId,
  summarizeText,
} from './-lib'
import type { ReplyType } from '@/components/FactCheckReplyTitle'

import { FactCheckReplyTitle } from '@/components/FactCheckReplyTitle'
import { getPageOrigin } from '@/lib/pageOrigin'
import { cofactsExec } from '@/server/cofacts.server'
import { graphql } from '@/server/gql'

/**
 * /article/:id — 單一訊息 (Penpot MessagePage-1440 / MessagePage-原始訊息).
 * This is the page skeleton of Track 2: the data path, the sections and their
 * anchors (Phase 3 design doc §2.4), and 本頁索引. Each section is filled in by
 * a later PR (cofacts/ai#184).
 */

const getArticle = createServerFn({ method: 'GET' })
  .validator((id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('id must be text')
    return id
  })
  .handler(({ data: id }) =>
    cofactsExec(
      graphql(`
        query GetArticle($id: String!) {
          GetArticle(id: $id) {
            id
            text
            status
            replyRequestCount
            articleReplies(statuses: [NORMAL]) {
              replyId
              replyType
              reply {
                text
              }
            }
          }
        }
      `),
      { id },
    ),
  )

// queryKey = [GraphQL operation name, variables]; key and queryFn live together.
const articleQuery = (id: string) =>
  queryOptions({
    queryKey: ['GetArticle', id],
    queryFn: () => getArticle({ data: id }),
    staleTime: 60_000,
  })

const TITLE_LENGTH = 60
const DESCRIPTION_LENGTH = 160

export const Route = createFileRoute('/article/$id/')({
  // Awaited so a failed query reaches the router (500 + error component). rumors-api
  // answers an unknown id with null, which is a 404 here. Only head()'s fields are returned:
  // the page reads the cache.
  loader: async ({ context, params }) => {
    const { GetArticle: article } = await context.queryClient.ensureQueryData(
      articleQuery(params.id),
    )
    if (!article) throw notFound()
    const replyTypes = article.articleReplies.map((reply) => reply.replyType)
    const url = `${getPageOrigin()}/article/${encodeURIComponent(params.id)}`
    const version = ogImageVersion({
      status: article.status,
      replyTypes,
      replyRequestCount: article.replyRequestCount,
    })
    return {
      title: summarizeText(article.text, TITLE_LENGTH),
      description: summarizeText(article.text, DESCRIPTION_LENGTH),
      url,
      imageUrl: `${url}/og.png?v=${version}`,
      verdict: ogVerdict(replyTypes),
    }
  },
  head: ({ loaderData }) => (loaderData ? getArticleHead(loaderData) : {}),
  component: ArticlePage,
})

function ArticlePage() {
  const { id } = Route.useParams()
  const { data } = useSuspenseQuery(articleQuery(id))
  // The loader threw notFound() when there was no article.
  const article = data.GetArticle!
  const replies = article.articleReplies
  const quickNavItems = getQuickNavItems({ replyCount: replies.length })

  return (
    <main className="mx-auto flex w-full max-w-[1136px] flex-1 flex-col gap-spacing-32 px-spacing-20 py-spacing-32 lg:grid lg:grid-cols-[minmax(0,1fr)_200px] lg:items-start lg:px-spacing-48">
      {/* The design shows no page title; the h1 is for screen readers and outlines. */}
      <h1 className="sr-only">可疑訊息</h1>

      {/* First in the DOM so the mobile row sits at the top; the second column on desktop. */}
      <ArticleQuickNav items={quickNavItems} className="lg:col-start-2" />

      <div className="flex flex-col gap-spacing-48 lg:col-start-1 lg:row-start-1">
        <ArticleSection id={ARTICLE_SECTION_IDS.original} title="原始訊息">
          <p className="text-type-body-m whitespace-pre-wrap text-text-primary">
            {article.text || '這則訊息沒有文字內容。'}
          </p>
        </ArticleSection>

        <ArticleSection
          id={ARTICLE_SECTION_IDS.replies}
          title={`查核回應 (${replies.length})`}
        >
          {replies.length === 0 ? (
            <p className="text-type-body-m text-text-secondary">
              這則訊息還沒有查核回應。
            </p>
          ) : (
            <ul className="flex flex-col gap-spacing-24">
              {replies.map((articleReply) => (
                <li
                  key={articleReply.replyId}
                  id={replyAnchorId(articleReply.replyId)}
                  className="flex scroll-mt-[124px] flex-col gap-spacing-8 lg:scroll-mt-[88px]"
                >
                  {articleReply.replyType && (
                    <FactCheckReplyTitle
                      type={articleReply.replyType as ReplyType}
                    />
                  )}
                  <p className="text-type-body-m whitespace-pre-wrap text-text-primary">
                    {articleReply.reply?.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ArticleSection>

        {replies.length === 0 && (
          <ArticleSection
            id={ARTICLE_SECTION_IDS.aiAnalysis}
            title="AI 自動分析"
          >
            <p className="text-type-body-m text-text-secondary">準備中。</p>
          </ArticleSection>
        )}

        <ArticleSection
          id={ARTICLE_SECTION_IDS.similar}
          title="相似可疑訊息與組合"
        >
          <p className="text-type-body-m text-text-secondary">準備中。</p>
        </ArticleSection>
      </div>
    </main>
  )
}
