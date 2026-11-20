/* eslint-disable */
import * as types from './graphql'
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
  '\n      query ListArticles {\n        ListArticles(first: 10, orderBy: [{ lastRequestedAt: DESC }]) {\n          totalCount\n          edges {\n            node {\n              id\n              text\n              articleType\n              createdAt\n              replyRequestCount\n              articleReplies(status: NORMAL) {\n                replyType\n              }\n            }\n          }\n        }\n      }\n    ': typeof types.ListArticlesDocument
  '\n      query ListCategoriesForArticle {\n        ListCategories(first: 50) {\n          edges {\n            node {\n              id\n              title\n              description\n            }\n          }\n        }\n      }\n    ': typeof types.ListCategoriesForArticleDocument
  '\n        mutation AddArticleCategory($articleId: String!, $categoryId: String!) {\n          CreateArticleCategory(\n            articleId: $articleId\n            categoryId: $categoryId\n          ) {\n            categoryId\n          }\n        }\n      ': typeof types.AddArticleCategoryDocument
  '\n        mutation RemoveArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n        ) {\n          UpdateArticleCategoryStatus(\n            articleId: $articleId\n            categoryId: $categoryId\n            status: DELETED\n          ) {\n            categoryId\n          }\n        }\n      ': typeof types.RemoveArticleCategoryDocument
  '\n        mutation VoteArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n          $vote: FeedbackVote!\n          $comment: String\n        ) {\n          CreateOrUpdateArticleCategoryFeedback(\n            articleId: $articleId\n            categoryId: $categoryId\n            vote: $vote\n            comment: $comment\n          ) {\n            categoryId\n          }\n        }\n      ': typeof types.VoteArticleCategoryDocument
  '\n        query ListArticleCategoryDisagreements($articleId: String!) {\n          GetArticle(id: $articleId) {\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              feedbacks {\n                id\n                vote\n                comment\n                user {\n                  name\n                }\n              }\n            }\n          }\n        }\n      ': typeof types.ListArticleCategoryDisagreementsDocument
  '\n        query GetArticle($id: String!) {\n          GetArticle(id: $id) {\n            id\n            text\n            articleType\n            createdAt\n            replyRequestCount\n            attachmentUrl(variant: PREVIEW)\n            # Only for logged-in website users; null otherwise.\n            originalAttachmentUrl: attachmentUrl(variant: ORIGINAL)\n            hyperlinks {\n              url\n              title\n              summary\n              topImageUrl\n            }\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              category {\n                title\n                description\n              }\n              positiveFeedbackCount\n              negativeFeedbackCount\n              ownVote\n              canUpdateStatus\n            }\n            articleReplies(statuses: [NORMAL]) {\n              replyId\n              replyType\n              reply {\n                text\n              }\n            }\n          }\n        }\n      ': typeof types.GetArticleDocument
  '\n          query ReportOutcomeArticle($id: String!) {\n            GetArticle(id: $id) {\n              id\n              replyRequestCount\n              articleReplies(statuses: [NORMAL]) {\n                positiveFeedbackCount\n                negativeFeedbackCount\n                reply {\n                  type\n                  text\n                  reference\n                  user {\n                    name\n                  }\n                }\n              }\n            }\n          }\n        ': typeof types.ReportOutcomeArticleDocument
  '\n        query SearchSuspiciousMessages($like: String!, $first: Int!) {\n          ListArticles(\n            filter: { moreLikeThis: { like: $like } }\n            orderBy: [{ _score: DESC }]\n            first: $first\n          ) {\n            edges {\n              node {\n                id\n                text\n                articleType\n                replyCount\n                replyRequestCount\n                hyperlinks {\n                  title\n                }\n              }\n            }\n          }\n        }\n      ': typeof types.SearchSuspiciousMessagesDocument
  '\n        mutation RequestFactCheck($articleId: String!, $reason: String) {\n          CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n            id\n          }\n        }\n      ': typeof types.RequestFactCheckDocument
  '\n        mutation CreateArticleReport(\n          $text: String!\n          $reference: ArticleReferenceInput!\n          $reason: String\n        ) {\n          CreateArticle(text: $text, reference: $reference, reason: $reason) {\n            id\n          }\n        }\n      ': typeof types.CreateArticleReportDocument
  '\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n': typeof types.GetCurrentUserDocument
}
const documents: Documents = {
  '\n      query ListArticles {\n        ListArticles(first: 10, orderBy: [{ lastRequestedAt: DESC }]) {\n          totalCount\n          edges {\n            node {\n              id\n              text\n              articleType\n              createdAt\n              replyRequestCount\n              articleReplies(status: NORMAL) {\n                replyType\n              }\n            }\n          }\n        }\n      }\n    ':
    types.ListArticlesDocument,
  '\n      query ListCategoriesForArticle {\n        ListCategories(first: 50) {\n          edges {\n            node {\n              id\n              title\n              description\n            }\n          }\n        }\n      }\n    ':
    types.ListCategoriesForArticleDocument,
  '\n        mutation AddArticleCategory($articleId: String!, $categoryId: String!) {\n          CreateArticleCategory(\n            articleId: $articleId\n            categoryId: $categoryId\n          ) {\n            categoryId\n          }\n        }\n      ':
    types.AddArticleCategoryDocument,
  '\n        mutation RemoveArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n        ) {\n          UpdateArticleCategoryStatus(\n            articleId: $articleId\n            categoryId: $categoryId\n            status: DELETED\n          ) {\n            categoryId\n          }\n        }\n      ':
    types.RemoveArticleCategoryDocument,
  '\n        mutation VoteArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n          $vote: FeedbackVote!\n          $comment: String\n        ) {\n          CreateOrUpdateArticleCategoryFeedback(\n            articleId: $articleId\n            categoryId: $categoryId\n            vote: $vote\n            comment: $comment\n          ) {\n            categoryId\n          }\n        }\n      ':
    types.VoteArticleCategoryDocument,
  '\n        query ListArticleCategoryDisagreements($articleId: String!) {\n          GetArticle(id: $articleId) {\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              feedbacks {\n                id\n                vote\n                comment\n                user {\n                  name\n                }\n              }\n            }\n          }\n        }\n      ':
    types.ListArticleCategoryDisagreementsDocument,
  '\n        query GetArticle($id: String!) {\n          GetArticle(id: $id) {\n            id\n            text\n            articleType\n            createdAt\n            replyRequestCount\n            attachmentUrl(variant: PREVIEW)\n            # Only for logged-in website users; null otherwise.\n            originalAttachmentUrl: attachmentUrl(variant: ORIGINAL)\n            hyperlinks {\n              url\n              title\n              summary\n              topImageUrl\n            }\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              category {\n                title\n                description\n              }\n              positiveFeedbackCount\n              negativeFeedbackCount\n              ownVote\n              canUpdateStatus\n            }\n            articleReplies(statuses: [NORMAL]) {\n              replyId\n              replyType\n              reply {\n                text\n              }\n            }\n          }\n        }\n      ':
    types.GetArticleDocument,
  '\n          query ReportOutcomeArticle($id: String!) {\n            GetArticle(id: $id) {\n              id\n              replyRequestCount\n              articleReplies(statuses: [NORMAL]) {\n                positiveFeedbackCount\n                negativeFeedbackCount\n                reply {\n                  type\n                  text\n                  reference\n                  user {\n                    name\n                  }\n                }\n              }\n            }\n          }\n        ':
    types.ReportOutcomeArticleDocument,
  '\n        query SearchSuspiciousMessages($like: String!, $first: Int!) {\n          ListArticles(\n            filter: { moreLikeThis: { like: $like } }\n            orderBy: [{ _score: DESC }]\n            first: $first\n          ) {\n            edges {\n              node {\n                id\n                text\n                articleType\n                replyCount\n                replyRequestCount\n                hyperlinks {\n                  title\n                }\n              }\n            }\n          }\n        }\n      ':
    types.SearchSuspiciousMessagesDocument,
  '\n        mutation RequestFactCheck($articleId: String!, $reason: String) {\n          CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n            id\n          }\n        }\n      ':
    types.RequestFactCheckDocument,
  '\n        mutation CreateArticleReport(\n          $text: String!\n          $reference: ArticleReferenceInput!\n          $reason: String\n        ) {\n          CreateArticle(text: $text, reference: $reference, reason: $reason) {\n            id\n          }\n        }\n      ':
    types.CreateArticleReportDocument,
  '\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n':
    types.GetCurrentUserDocument,
}

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n      query ListArticles {\n        ListArticles(first: 10, orderBy: [{ lastRequestedAt: DESC }]) {\n          totalCount\n          edges {\n            node {\n              id\n              text\n              articleType\n              createdAt\n              replyRequestCount\n              articleReplies(status: NORMAL) {\n                replyType\n              }\n            }\n          }\n        }\n      }\n    ',
): (typeof documents)['\n      query ListArticles {\n        ListArticles(first: 10, orderBy: [{ lastRequestedAt: DESC }]) {\n          totalCount\n          edges {\n            node {\n              id\n              text\n              articleType\n              createdAt\n              replyRequestCount\n              articleReplies(status: NORMAL) {\n                replyType\n              }\n            }\n          }\n        }\n      }\n    ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n      query ListCategoriesForArticle {\n        ListCategories(first: 50) {\n          edges {\n            node {\n              id\n              title\n              description\n            }\n          }\n        }\n      }\n    ',
): (typeof documents)['\n      query ListCategoriesForArticle {\n        ListCategories(first: 50) {\n          edges {\n            node {\n              id\n              title\n              description\n            }\n          }\n        }\n      }\n    ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        mutation AddArticleCategory($articleId: String!, $categoryId: String!) {\n          CreateArticleCategory(\n            articleId: $articleId\n            categoryId: $categoryId\n          ) {\n            categoryId\n          }\n        }\n      ',
): (typeof documents)['\n        mutation AddArticleCategory($articleId: String!, $categoryId: String!) {\n          CreateArticleCategory(\n            articleId: $articleId\n            categoryId: $categoryId\n          ) {\n            categoryId\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        mutation RemoveArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n        ) {\n          UpdateArticleCategoryStatus(\n            articleId: $articleId\n            categoryId: $categoryId\n            status: DELETED\n          ) {\n            categoryId\n          }\n        }\n      ',
): (typeof documents)['\n        mutation RemoveArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n        ) {\n          UpdateArticleCategoryStatus(\n            articleId: $articleId\n            categoryId: $categoryId\n            status: DELETED\n          ) {\n            categoryId\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        mutation VoteArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n          $vote: FeedbackVote!\n          $comment: String\n        ) {\n          CreateOrUpdateArticleCategoryFeedback(\n            articleId: $articleId\n            categoryId: $categoryId\n            vote: $vote\n            comment: $comment\n          ) {\n            categoryId\n          }\n        }\n      ',
): (typeof documents)['\n        mutation VoteArticleCategory(\n          $articleId: String!\n          $categoryId: String!\n          $vote: FeedbackVote!\n          $comment: String\n        ) {\n          CreateOrUpdateArticleCategoryFeedback(\n            articleId: $articleId\n            categoryId: $categoryId\n            vote: $vote\n            comment: $comment\n          ) {\n            categoryId\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        query ListArticleCategoryDisagreements($articleId: String!) {\n          GetArticle(id: $articleId) {\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              feedbacks {\n                id\n                vote\n                comment\n                user {\n                  name\n                }\n              }\n            }\n          }\n        }\n      ',
): (typeof documents)['\n        query ListArticleCategoryDisagreements($articleId: String!) {\n          GetArticle(id: $articleId) {\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              feedbacks {\n                id\n                vote\n                comment\n                user {\n                  name\n                }\n              }\n            }\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        query GetArticle($id: String!) {\n          GetArticle(id: $id) {\n            id\n            text\n            articleType\n            createdAt\n            replyRequestCount\n            attachmentUrl(variant: PREVIEW)\n            # Only for logged-in website users; null otherwise.\n            originalAttachmentUrl: attachmentUrl(variant: ORIGINAL)\n            hyperlinks {\n              url\n              title\n              summary\n              topImageUrl\n            }\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              category {\n                title\n                description\n              }\n              positiveFeedbackCount\n              negativeFeedbackCount\n              ownVote\n              canUpdateStatus\n            }\n            articleReplies(statuses: [NORMAL]) {\n              replyId\n              replyType\n              reply {\n                text\n              }\n            }\n          }\n        }\n      ',
): (typeof documents)['\n        query GetArticle($id: String!) {\n          GetArticle(id: $id) {\n            id\n            text\n            articleType\n            createdAt\n            replyRequestCount\n            attachmentUrl(variant: PREVIEW)\n            # Only for logged-in website users; null otherwise.\n            originalAttachmentUrl: attachmentUrl(variant: ORIGINAL)\n            hyperlinks {\n              url\n              title\n              summary\n              topImageUrl\n            }\n            articleCategories(statuses: [NORMAL]) {\n              categoryId\n              category {\n                title\n                description\n              }\n              positiveFeedbackCount\n              negativeFeedbackCount\n              ownVote\n              canUpdateStatus\n            }\n            articleReplies(statuses: [NORMAL]) {\n              replyId\n              replyType\n              reply {\n                text\n              }\n            }\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n          query ReportOutcomeArticle($id: String!) {\n            GetArticle(id: $id) {\n              id\n              replyRequestCount\n              articleReplies(statuses: [NORMAL]) {\n                positiveFeedbackCount\n                negativeFeedbackCount\n                reply {\n                  type\n                  text\n                  reference\n                  user {\n                    name\n                  }\n                }\n              }\n            }\n          }\n        ',
): (typeof documents)['\n          query ReportOutcomeArticle($id: String!) {\n            GetArticle(id: $id) {\n              id\n              replyRequestCount\n              articleReplies(statuses: [NORMAL]) {\n                positiveFeedbackCount\n                negativeFeedbackCount\n                reply {\n                  type\n                  text\n                  reference\n                  user {\n                    name\n                  }\n                }\n              }\n            }\n          }\n        ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        query SearchSuspiciousMessages($like: String!, $first: Int!) {\n          ListArticles(\n            filter: { moreLikeThis: { like: $like } }\n            orderBy: [{ _score: DESC }]\n            first: $first\n          ) {\n            edges {\n              node {\n                id\n                text\n                articleType\n                replyCount\n                replyRequestCount\n                hyperlinks {\n                  title\n                }\n              }\n            }\n          }\n        }\n      ',
): (typeof documents)['\n        query SearchSuspiciousMessages($like: String!, $first: Int!) {\n          ListArticles(\n            filter: { moreLikeThis: { like: $like } }\n            orderBy: [{ _score: DESC }]\n            first: $first\n          ) {\n            edges {\n              node {\n                id\n                text\n                articleType\n                replyCount\n                replyRequestCount\n                hyperlinks {\n                  title\n                }\n              }\n            }\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        mutation RequestFactCheck($articleId: String!, $reason: String) {\n          CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n            id\n          }\n        }\n      ',
): (typeof documents)['\n        mutation RequestFactCheck($articleId: String!, $reason: String) {\n          CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n            id\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n        mutation CreateArticleReport(\n          $text: String!\n          $reference: ArticleReferenceInput!\n          $reason: String\n        ) {\n          CreateArticle(text: $text, reference: $reference, reason: $reason) {\n            id\n          }\n        }\n      ',
): (typeof documents)['\n        mutation CreateArticleReport(\n          $text: String!\n          $reference: ArticleReferenceInput!\n          $reason: String\n        ) {\n          CreateArticle(text: $text, reference: $reference, reason: $reason) {\n            id\n          }\n        }\n      ']
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n',
): (typeof documents)['\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n']

export function graphql(source: string) {
  return (documents as any)[source] ?? {}
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never
