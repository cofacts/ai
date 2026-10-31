/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never
    }
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
export type ArticleTypeEnum = 'AUDIO' | 'IMAGE' | 'TEXT' | 'VIDEO'

export type AvatarTypeEnum = 'Facebook' | 'Github' | 'Gravatar' | 'OpenPeeps'

/** Reflects how the replier categories the replied article. */
export type ReplyTypeEnum =
  /** The replier thinks that the article is actually not a complete article on the internet or passed around in messengers. */
  | 'NOT_ARTICLE'
  /** The replier thinks that the articles contains no false information. */
  | 'NOT_RUMOR'
  /** The replier thinks that the article contains personal viewpoint and is not objective. */
  | 'OPINIONATED'
  /** The replier thinks that the article contains false information. */
  | 'RUMOR'

export type ListArticlesQueryVariables = Exact<{ [key: string]: never }>

export type ListArticlesQuery = {
  ListArticles: {
    totalCount: number
    edges: Array<{
      node: {
        id: string
        text: string | null
        articleType: ArticleTypeEnum
        createdAt: string | null
        replyRequestCount: number | null
        articleReplies: Array<{ replyType: ReplyTypeEnum | null }>
      }
    }>
  } | null
}

export type GetCurrentUserQueryVariables = Exact<{ [key: string]: never }>

export type GetCurrentUserQuery = {
  GetUser: {
    id: string
    name: string | null
    avatarUrl: string | null
    avatarType: AvatarTypeEnum | null
    avatarData: string | null
  } | null
}

export const ListArticlesDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'ListArticles' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'ListArticles' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '10' },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'orderBy' },
                value: {
                  kind: 'ListValue',
                  values: [
                    {
                      kind: 'ObjectValue',
                      fields: [
                        {
                          kind: 'ObjectField',
                          name: { kind: 'Name', value: 'lastRequestedAt' },
                          value: { kind: 'EnumValue', value: 'DESC' },
                        },
                      ],
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'totalCount' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edges' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'node' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'id' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'text' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'articleType' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'createdAt' },
                            },
                            {
                              kind: 'Field',
                              name: {
                                kind: 'Name',
                                value: 'replyRequestCount',
                              },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'articleReplies' },
                              arguments: [
                                {
                                  kind: 'Argument',
                                  name: { kind: 'Name', value: 'status' },
                                  value: { kind: 'EnumValue', value: 'NORMAL' },
                                },
                              ],
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'replyType' },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ListArticlesQuery, ListArticlesQueryVariables>
export const GetCurrentUserDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetCurrentUser' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'GetUser' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'avatarUrl' } },
                { kind: 'Field', name: { kind: 'Name', value: 'avatarType' } },
                { kind: 'Field', name: { kind: 'Name', value: 'avatarData' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetCurrentUserQuery, GetCurrentUserQueryVariables>
