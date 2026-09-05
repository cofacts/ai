/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ArticleReferenceInput = {
  permalink?: string | null | undefined;
  type: ArticleReferenceTypeEnum;
};

/** Where this article is collected from. */
export type ArticleReferenceTypeEnum =
  /** The article is collected from conversations in LINE messengers. */
  | 'LINE'
  /** The article is collected from the Internet, with a link to the article available. */
  | 'URL';

export type ArticleTypeEnum =
  | 'AUDIO'
  | 'IMAGE'
  | 'TEXT'
  | 'VIDEO';

export type AvatarTypeEnum =
  | 'Facebook'
  | 'Github'
  | 'Gravatar'
  | 'OpenPeeps';

/** Reflects how the replier categories the replied article. */
export type ReplyTypeEnum =
  /** The replier thinks that the article is actually not a complete article on the internet or passed around in messengers. */
  | 'NOT_ARTICLE'
  /** The replier thinks that the articles contains no false information. */
  | 'NOT_RUMOR'
  /** The replier thinks that the article contains personal viewpoint and is not objective. */
  | 'OPINIONATED'
  /** The replier thinks that the article contains false information. */
  | 'RUMOR';

export type GetCurrentUserQueryVariables = Exact<{ [key: string]: never; }>;


export type GetCurrentUserQuery = { GetUser: { id: string, name: string | null, avatarUrl: string | null, avatarType: AvatarTypeEnum | null, avatarData: string | null } | null };

export type SearchSuspiciousMessagesQueryVariables = Exact<{
  like: string;
  first: number;
  minimumShouldMatch?: string | null | undefined;
}>;


export type SearchSuspiciousMessagesQuery = { ListArticles: { totalCount: number, edges: Array<{ score: number | null, node: { id: string, text: string | null, articleType: ArticleTypeEnum, createdAt: string | null, replyCount: number, replyRequestCount: number | null } }> } | null };

export type ReportOutcomeArticleQueryVariables = Exact<{
  id: string;
}>;


export type ReportOutcomeArticleQuery = { GetArticle: { id: string, text: string | null, articleType: ArticleTypeEnum, createdAt: string | null, replyCount: number, replyRequestCount: number | null, attachmentUrl: string | null, articleReplies: Array<{ createdAt: string | null, positiveFeedbackCount: number, negativeFeedbackCount: number, user: { name: string | null } | null, reply: { id: string, type: ReplyTypeEnum, text: string | null, reference: string | null, createdAt: string | null, user: { name: string | null } | null } | null }> } | null };

export type RequestFactCheckMutationVariables = Exact<{
  articleId: string;
  reason?: string | null | undefined;
}>;


export type RequestFactCheckMutation = { CreateOrUpdateReplyRequest: { id: string, replyRequestCount: number | null } | null };

export type CreateArticleReportMutationVariables = Exact<{
  text: string;
  reference: ArticleReferenceInput;
  reason?: string | null | undefined;
}>;


export type CreateArticleReportMutation = { CreateArticle: { id: string | null } | null };


export const GetCurrentUserDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCurrentUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"GetUser"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"avatarUrl"}},{"kind":"Field","name":{"kind":"Name","value":"avatarType"}},{"kind":"Field","name":{"kind":"Name","value":"avatarData"}}]}}]}}]} as unknown as DocumentNode<GetCurrentUserQuery, GetCurrentUserQueryVariables>;
export const SearchSuspiciousMessagesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SearchSuspiciousMessages"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"like"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"minimumShouldMatch"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"ListArticles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"moreLikeThis"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"like"},"value":{"kind":"Variable","name":{"kind":"Name","value":"like"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"minimumShouldMatch"},"value":{"kind":"Variable","name":{"kind":"Name","value":"minimumShouldMatch"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"ListValue","values":[{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"_score"},"value":{"kind":"EnumValue","value":"DESC"}}]}]}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"totalCount"}},{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"score"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"articleType"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}},{"kind":"Field","name":{"kind":"Name","value":"replyRequestCount"}}]}}]}}]}}]}}]} as unknown as DocumentNode<SearchSuspiciousMessagesQuery, SearchSuspiciousMessagesQueryVariables>;
export const ReportOutcomeArticleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ReportOutcomeArticle"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"GetArticle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"articleType"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"replyCount"}},{"kind":"Field","name":{"kind":"Name","value":"replyRequestCount"}},{"kind":"Field","name":{"kind":"Name","value":"attachmentUrl"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"variant"},"value":{"kind":"EnumValue","value":"PREVIEW"}}]},{"kind":"Field","name":{"kind":"Name","value":"articleReplies"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"statuses"},"value":{"kind":"ListValue","values":[{"kind":"EnumValue","value":"NORMAL"}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"positiveFeedbackCount"}},{"kind":"Field","name":{"kind":"Name","value":"negativeFeedbackCount"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"reply"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"reference"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"user"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<ReportOutcomeArticleQuery, ReportOutcomeArticleQueryVariables>;
export const RequestFactCheckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RequestFactCheck"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"articleId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"CreateOrUpdateReplyRequest"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"articleId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"articleId"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"replyRequestCount"}}]}}]}}]} as unknown as DocumentNode<RequestFactCheckMutation, RequestFactCheckMutationVariables>;
export const CreateArticleReportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateArticleReport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"text"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reference"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ArticleReferenceInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"reason"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"CreateArticle"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"text"},"value":{"kind":"Variable","name":{"kind":"Name","value":"text"}}},{"kind":"Argument","name":{"kind":"Name","value":"reference"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reference"}}},{"kind":"Argument","name":{"kind":"Name","value":"reason"},"value":{"kind":"Variable","name":{"kind":"Name","value":"reason"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateArticleReportMutation, CreateArticleReportMutationVariables>;