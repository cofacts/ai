// Server functions for the categories of /article/:id (rumors-site's
// ArticleCategories): the list to suggest from, marking and unmarking a category,
// and agreeing or disagreeing with one. The writes need a logged-in user;
// rumors-api rejects them otherwise.

import { createServerFn } from '@tanstack/react-start'
import { queryOptions } from '@tanstack/react-query'

import { cofactsExec } from '@/server/cofacts.server'
import { graphql } from '@/server/gql'

const COMMENT_MAX_LENGTH = 500

function requireId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`${name} must be text`)
  return value
}

type ArticleCategoryInput = { articleId: string; categoryId: string }

function validateArticleCategory(input: unknown): ArticleCategoryInput {
  const { articleId, categoryId } = (input ?? {}) as Record<string, unknown>
  return {
    articleId: requireId(articleId, 'articleId'),
    categoryId: requireId(categoryId, 'categoryId'),
  }
}

/** Every category one can suggest. rumors-site lists the first 50; there are fewer. */
export const listCategories = createServerFn({ method: 'GET' }).handler(() =>
  cofactsExec(
    graphql(`
      query ListCategoriesForArticle {
        ListCategories(first: 50) {
          edges {
            node {
              id
              title
              description
            }
          }
        }
      }
    `),
  ),
)

export const categoriesQuery = queryOptions({
  queryKey: ['ListCategoriesForArticle'],
  queryFn: () => listCategories(),
  // The list changes when an admin adds a category, which is rare.
  staleTime: 60 * 60_000,
})

export const addArticleCategory = createServerFn({ method: 'POST' })
  .inputValidator(validateArticleCategory)
  .handler(({ data }) =>
    cofactsExec(
      graphql(`
        mutation AddArticleCategory($articleId: String!, $categoryId: String!) {
          CreateArticleCategory(
            articleId: $articleId
            categoryId: $categoryId
          ) {
            categoryId
          }
        }
      `),
      data,
    ),
  )

/** Only the person who marked it can unmark it (`canUpdateStatus`). */
export const removeArticleCategory = createServerFn({ method: 'POST' })
  .inputValidator(validateArticleCategory)
  .handler(({ data }) =>
    cofactsExec(
      graphql(`
        mutation RemoveArticleCategory(
          $articleId: String!
          $categoryId: String!
        ) {
          UpdateArticleCategoryStatus(
            articleId: $articleId
            categoryId: $categoryId
            status: DELETED
          ) {
            categoryId
          }
        }
      `),
      data,
    ),
  )

export type CategoryVote = 'UPVOTE' | 'DOWNVOTE'

export const voteArticleCategory = createServerFn({ method: 'POST' })
  .inputValidator(
    (
      input: ArticleCategoryInput & { vote: CategoryVote; comment?: string },
    ) => {
      const ids = validateArticleCategory(input)
      // Checked at runtime: the RPC body comes from the browser, whatever the type says.
      const { vote, comment } = input as Record<string, unknown>
      if (vote !== 'UPVOTE' && vote !== 'DOWNVOTE') {
        throw new Error('vote must be UPVOTE or DOWNVOTE')
      }
      if (comment !== undefined && typeof comment !== 'string') {
        throw new Error('comment must be text')
      }
      return {
        ...ids,
        vote: vote as CategoryVote,
        // Only a disagreement carries a reason, as on rumors-site.
        comment:
          vote === 'DOWNVOTE'
            ? comment?.trim().slice(0, COMMENT_MAX_LENGTH) || undefined
            : undefined,
      }
    },
  )
  .handler(({ data }) =>
    cofactsExec(
      graphql(`
        mutation VoteArticleCategory(
          $articleId: String!
          $categoryId: String!
          $vote: FeedbackVote!
          $comment: String
        ) {
          CreateOrUpdateArticleCategoryFeedback(
            articleId: $articleId
            categoryId: $categoryId
            vote: $vote
            comment: $comment
          ) {
            categoryId
          }
        }
      `),
      data,
    ),
  )

/** Why others disagreed with a category: shown before one adds a reason of one's own. */
export const listCategoryDisagreements = createServerFn({ method: 'GET' })
  .inputValidator(validateArticleCategory)
  .handler(async ({ data: { articleId, categoryId } }) => {
    const result = await cofactsExec(
      graphql(`
        query ListArticleCategoryDisagreements($articleId: String!) {
          GetArticle(id: $articleId) {
            articleCategories(statuses: [NORMAL]) {
              categoryId
              feedbacks {
                id
                vote
                comment
                user {
                  name
                }
              }
            }
          }
        }
      `),
      { articleId },
    )
    // Only the reasons are returned: the rest of the feedback stays on the server.
    return (
      result.GetArticle?.articleCategories
        .find((ac) => ac.categoryId === categoryId)
        ?.feedbacks?.flatMap((feedback) =>
          feedback?.vote === 'DOWNVOTE' && feedback.comment?.trim()
            ? [
                {
                  id: feedback.id,
                  comment: feedback.comment.trim(),
                  userName: feedback.user?.name ?? null,
                },
              ]
            : [],
        ) ?? []
    )
  })

export const categoryDisagreementsQuery = (input: ArticleCategoryInput) =>
  queryOptions({
    queryKey: ['ListArticleCategoryDisagreements', input],
    queryFn: () => listCategoryDisagreements({ data: input }),
    staleTime: 60_000,
  })
