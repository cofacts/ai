/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

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
    "\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n": typeof types.GetCurrentUserDocument,
    "\n  query SearchSuspiciousMessages(\n    $like: String!\n    $first: Int!\n    $minimumShouldMatch: String\n  ) {\n    ListArticles(\n      filter: {\n        moreLikeThis: { like: $like, minimumShouldMatch: $minimumShouldMatch }\n      }\n      orderBy: [{ _score: DESC }]\n      first: $first\n    ) {\n      totalCount\n      edges {\n        score\n        node {\n          id\n          text\n          articleType\n          createdAt\n          replyCount\n          replyRequestCount\n        }\n      }\n    }\n  }\n": typeof types.SearchSuspiciousMessagesDocument,
    "\n  query ReportOutcomeArticle($id: String!) {\n    GetArticle(id: $id) {\n      id\n      text\n      articleType\n      createdAt\n      replyCount\n      replyRequestCount\n      attachmentUrl(variant: PREVIEW)\n      articleReplies(statuses: [NORMAL]) {\n        createdAt\n        positiveFeedbackCount\n        negativeFeedbackCount\n        user {\n          name\n        }\n        reply {\n          id\n          type\n          text\n          reference\n          createdAt\n          user {\n            name\n          }\n        }\n      }\n    }\n  }\n": typeof types.ReportOutcomeArticleDocument,
    "\n  mutation RequestFactCheck($articleId: String!, $reason: String) {\n    CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n      id\n      replyRequestCount\n    }\n  }\n": typeof types.RequestFactCheckDocument,
    "\n  mutation CreateArticleReport(\n    $text: String!\n    $reference: ArticleReferenceInput!\n    $reason: String\n  ) {\n    CreateArticle(text: $text, reference: $reference, reason: $reason) {\n      id\n    }\n  }\n": typeof types.CreateArticleReportDocument,
};
const documents: Documents = {
    "\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n": types.GetCurrentUserDocument,
    "\n  query SearchSuspiciousMessages(\n    $like: String!\n    $first: Int!\n    $minimumShouldMatch: String\n  ) {\n    ListArticles(\n      filter: {\n        moreLikeThis: { like: $like, minimumShouldMatch: $minimumShouldMatch }\n      }\n      orderBy: [{ _score: DESC }]\n      first: $first\n    ) {\n      totalCount\n      edges {\n        score\n        node {\n          id\n          text\n          articleType\n          createdAt\n          replyCount\n          replyRequestCount\n        }\n      }\n    }\n  }\n": types.SearchSuspiciousMessagesDocument,
    "\n  query ReportOutcomeArticle($id: String!) {\n    GetArticle(id: $id) {\n      id\n      text\n      articleType\n      createdAt\n      replyCount\n      replyRequestCount\n      attachmentUrl(variant: PREVIEW)\n      articleReplies(statuses: [NORMAL]) {\n        createdAt\n        positiveFeedbackCount\n        negativeFeedbackCount\n        user {\n          name\n        }\n        reply {\n          id\n          type\n          text\n          reference\n          createdAt\n          user {\n            name\n          }\n        }\n      }\n    }\n  }\n": types.ReportOutcomeArticleDocument,
    "\n  mutation RequestFactCheck($articleId: String!, $reason: String) {\n    CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n      id\n      replyRequestCount\n    }\n  }\n": types.RequestFactCheckDocument,
    "\n  mutation CreateArticleReport(\n    $text: String!\n    $reference: ArticleReferenceInput!\n    $reason: String\n  ) {\n    CreateArticle(text: $text, reference: $reference, reason: $reason) {\n      id\n    }\n  }\n": types.CreateArticleReportDocument,
};

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
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n"): (typeof documents)["\n  query GetCurrentUser {\n    GetUser {\n      id\n      name\n      avatarUrl\n      avatarType\n      avatarData\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SearchSuspiciousMessages(\n    $like: String!\n    $first: Int!\n    $minimumShouldMatch: String\n  ) {\n    ListArticles(\n      filter: {\n        moreLikeThis: { like: $like, minimumShouldMatch: $minimumShouldMatch }\n      }\n      orderBy: [{ _score: DESC }]\n      first: $first\n    ) {\n      totalCount\n      edges {\n        score\n        node {\n          id\n          text\n          articleType\n          createdAt\n          replyCount\n          replyRequestCount\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query SearchSuspiciousMessages(\n    $like: String!\n    $first: Int!\n    $minimumShouldMatch: String\n  ) {\n    ListArticles(\n      filter: {\n        moreLikeThis: { like: $like, minimumShouldMatch: $minimumShouldMatch }\n      }\n      orderBy: [{ _score: DESC }]\n      first: $first\n    ) {\n      totalCount\n      edges {\n        score\n        node {\n          id\n          text\n          articleType\n          createdAt\n          replyCount\n          replyRequestCount\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ReportOutcomeArticle($id: String!) {\n    GetArticle(id: $id) {\n      id\n      text\n      articleType\n      createdAt\n      replyCount\n      replyRequestCount\n      attachmentUrl(variant: PREVIEW)\n      articleReplies(statuses: [NORMAL]) {\n        createdAt\n        positiveFeedbackCount\n        negativeFeedbackCount\n        user {\n          name\n        }\n        reply {\n          id\n          type\n          text\n          reference\n          createdAt\n          user {\n            name\n          }\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query ReportOutcomeArticle($id: String!) {\n    GetArticle(id: $id) {\n      id\n      text\n      articleType\n      createdAt\n      replyCount\n      replyRequestCount\n      attachmentUrl(variant: PREVIEW)\n      articleReplies(statuses: [NORMAL]) {\n        createdAt\n        positiveFeedbackCount\n        negativeFeedbackCount\n        user {\n          name\n        }\n        reply {\n          id\n          type\n          text\n          reference\n          createdAt\n          user {\n            name\n          }\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestFactCheck($articleId: String!, $reason: String) {\n    CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n      id\n      replyRequestCount\n    }\n  }\n"): (typeof documents)["\n  mutation RequestFactCheck($articleId: String!, $reason: String) {\n    CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {\n      id\n      replyRequestCount\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateArticleReport(\n    $text: String!\n    $reference: ArticleReferenceInput!\n    $reason: String\n  ) {\n    CreateArticle(text: $text, reference: $reference, reason: $reason) {\n      id\n    }\n  }\n"): (typeof documents)["\n  mutation CreateArticleReport(\n    $text: String!\n    $reference: ArticleReferenceInput!\n    $reason: String\n  ) {\n    CreateArticle(text: $text, reference: $reference, reason: $reason) {\n      id\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;