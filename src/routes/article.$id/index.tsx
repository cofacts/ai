import { useState } from 'react'
import { createFileRoute, notFound, useLocation } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'

import { ArticleCategories } from './-components/ArticleCategories'
import { ArticleOriginal } from './-components/ArticleOriginal'
import { ArticleQuickNav } from './-components/ArticleQuickNav'
import { ArticleSection } from './-components/ArticleSection'
import { CategoryDialog } from './-components/CategoryDialog'
import {
  addArticleCategory,
  categoriesQuery,
  categoryDisagreementsQuery,
  removeArticleCategory,
  voteArticleCategory,
} from './-categories.functions'
import { ARTICLE_SECTION_IDS, getQuickNavItems, replyAnchorId } from './-lib'
import type { CategoryVote } from './-categories.functions'
import type { CategoryOptionData } from './-components/CategoryDialog'
import type { ReplyType } from '@/components/FactCheckReplyTitle'
import type { GetArticleQuery } from '@/server/gql/graphql'

import { FactCheckReplyTitle } from '@/components/FactCheckReplyTitle'
import { useAuth } from '@/lib/auth'
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
            articleType
            createdAt
            replyRequestCount
            attachmentUrl(variant: PREVIEW)
            # Only for logged-in website users; null otherwise.
            originalAttachmentUrl: attachmentUrl(variant: ORIGINAL)
            hyperlinks {
              url
              title
              summary
              topImageUrl
            }
            articleCategories(statuses: [NORMAL]) {
              categoryId
              category {
                title
                description
              }
              positiveFeedbackCount
              negativeFeedbackCount
              ownVote
              canUpdateStatus
            }
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
    const text = article.text?.trim() ?? ''
    return {
      title: text.slice(0, TITLE_LENGTH),
      description: text.slice(0, DESCRIPTION_LENGTH),
    }
  },
  head: ({ loaderData }) => {
    const title = `${loaderData?.title || '可疑訊息'} | Cofacts 真的假的`
    return {
      meta: [
        { title },
        { property: 'og:title', content: title },
        ...(loaderData?.description
          ? [
              { name: 'description', content: loaderData.description },
              { property: 'og:description', content: loaderData.description },
            ]
          : []),
      ],
    }
  },
  component: ArticlePage,
})

function ArticlePage() {
  const { id } = Route.useParams()
  const { data } = useSuspenseQuery(articleQuery(id))
  // The loader threw notFound() when there was no article.
  const article = data.GetArticle!
  const replies = article.articleReplies
  const quickNavItems = getQuickNavItems({ replyCount: replies.length })
  const { user, login } = useAuth()
  const location = useLocation()

  return (
    <main className="mx-auto flex w-full max-w-[1136px] flex-1 flex-col gap-spacing-32 px-spacing-20 py-spacing-32 lg:grid lg:grid-cols-[minmax(0,1fr)_200px] lg:items-start lg:px-spacing-48">
      {/* The design shows no page title; the h1 is for screen readers and outlines. */}
      <h1 className="sr-only">可疑訊息</h1>

      {/* First in the DOM so the mobile row sits at the top; the second column on desktop. */}
      <ArticleQuickNav items={quickNavItems} className="lg:col-start-2" />

      <div className="flex flex-col gap-spacing-48 lg:col-start-1 lg:row-start-1">
        <ArticleSection id={ARTICLE_SECTION_IDS.original} title="原始訊息">
          <ArticleOriginal
            text={article.text}
            articleType={article.articleType}
            attachmentUrl={article.attachmentUrl}
            // GetArticle stays cached for a while after logout, so the original
            // file's URL counts only while someone is logged in.
            originalAttachmentUrl={user ? article.originalAttachmentUrl : null}
            // The schema lets both a hyperlink and its url be null; a card needs a url.
            hyperlinks={article.hyperlinks?.flatMap((link) =>
              link?.url ? [{ ...link, url: link.url }] : [],
            )}
            replyRequestCount={article.replyRequestCount}
            createdAt={article.createdAt}
            onLogin={() => login(location.pathname)}
          />
          <ArticleCategoriesPanel
            articleId={article.id}
            articleCategories={article.articleCategories}
          />
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

type ArticleCategoryRow = NonNullable<
  GetArticleQuery['GetArticle']
>['articleCategories'][number]

type CategoryWrite =
  | { kind: 'mark' | 'unmark'; categoryId: string }
  | { kind: 'vote'; categoryId: string; vote: CategoryVote; comment?: string }

const WRITE_DONE: Record<CategoryWrite['kind'], string> = {
  mark: '已標記分類。',
  unmark: '已取消標記。',
  vote: '感謝你的回饋。',
}

/**
 * 訊息分類 and its dialog. Holds the queries and writes so the components stay
 * presentational. Marking and voting need a login, so a logged-out visitor's
 * 分類建議 opens the login dialog instead.
 */
function ArticleCategoriesPanel({
  articleId,
  articleCategories,
}: {
  articleId: string
  articleCategories: Array<ArticleCategoryRow>
}) {
  const { user, login } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [disagreeingId, setDisagreeingId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const allCategories = useQuery({ ...categoriesQuery, enabled: open })
  const disagreements = useQuery({
    ...categoryDisagreementsQuery({
      articleId,
      categoryId: disagreeingId ?? '',
    }),
    enabled: open && disagreeingId !== null,
  })

  const write = useMutation({
    mutationFn: async (input: CategoryWrite) => {
      const ids = { articleId, categoryId: input.categoryId }
      switch (input.kind) {
        case 'mark':
          await addArticleCategory({ data: ids })
          return
        case 'unmark':
          await removeArticleCategory({ data: ids })
          return
        case 'vote':
          await voteArticleCategory({
            data: { ...ids, vote: input.vote, comment: input.comment },
          })
      }
    },
    onMutate: () => setStatusMessage(null),
    onSuccess: async (_, input) => {
      setStatusMessage(WRITE_DONE[input.kind])
      setDisagreeingId(null)
      // Keep the buttons disabled until the page shows the new counts.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['GetArticle', articleId] }),
        queryClient.invalidateQueries({
          queryKey: ['ListArticleCategoryDisagreements'],
        }),
      ])
    },
    onError: () => setStatusMessage('沒有成功，請稍後再試。'),
  })

  // categoryId is nullable in the schema, but an article category always has one.
  const rows = articleCategories.flatMap((row) =>
    row.categoryId ? [{ ...row, categoryId: row.categoryId }] : [],
  )
  const byCategoryId = new Map(rows.map((row) => [row.categoryId, row]))
  const options: Array<CategoryOptionData> | undefined =
    allCategories.data?.ListCategories?.edges.map(({ node }) => {
      const row = byCategoryId.get(node.id)
      return {
        id: node.id,
        title: node.title ?? '',
        description: node.description,
        marked: row !== undefined,
        // Like the original file's URL: a cached GetArticle may still hold the
        // previous user's vote and marks after logout.
        canUnmark: !!user && (row?.canUpdateStatus ?? false),
        ownVote: user ? row?.ownVote : null,
        positiveFeedbackCount: row?.positiveFeedbackCount,
        negativeFeedbackCount: row?.negativeFeedbackCount,
      }
    })

  return (
    <>
      <ArticleCategories
        categories={rows.map((row) => ({
          categoryId: row.categoryId,
          title: row.category?.title ?? '',
          positiveFeedbackCount: row.positiveFeedbackCount,
          negativeFeedbackCount: row.negativeFeedbackCount,
        }))}
        onSuggest={() => (user ? setOpen(true) : login(location.pathname))}
      />
      <CategoryDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setDisagreeingId(null)
            setStatusMessage(null)
          }
        }}
        categories={options}
        loadFailed={allCategories.isError}
        busyCategoryId={write.isPending ? write.variables.categoryId : null}
        statusMessage={statusMessage}
        disagreeingId={disagreeingId}
        disagreements={disagreements.data}
        onMark={(categoryId) => write.mutate({ kind: 'mark', categoryId })}
        onUnmark={(categoryId) => write.mutate({ kind: 'unmark', categoryId })}
        onAgree={(categoryId) =>
          write.mutate({ kind: 'vote', categoryId, vote: 'UPVOTE' })
        }
        onStartDisagree={setDisagreeingId}
        onCancelDisagree={() => setDisagreeingId(null)}
        onDisagree={(categoryId, comment) =>
          write.mutate({ kind: 'vote', categoryId, vote: 'DOWNVOTE', comment })
        }
      />
    </>
  )
}
