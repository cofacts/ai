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

export type FeedbackVote = 'DOWNVOTE' | 'NEUTRAL' | 'UPVOTE'

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

export type GetMyContributionsQueryVariables = Exact<{
  since: string
  first: number
}>

export type GetMyContributionsQuery = {
  GetUser: {
    id: string
    level: number
    points: { total: number; currentLevel: number; nextLevel: number }
    contributions: Array<{
      date: string | null
      count: number | null
    } | null> | null
  } | null
  myReports: {
    totalCount: number
    edges: Array<{
      node: {
        id: string
        reason: string | null
        createdAt: string | null
        article: {
          id: string
          text: string | null
          articleType: ArticleTypeEnum
          replyCount: number
          articleReplies: Array<{
            replyId: string
            userId: string
            ownVote: FeedbackVote | null
            feedbackCount: number
            replyType: ReplyTypeEnum | null
            reply: { text: string | null } | null
          }>
        }
      }
    }>
  } | null
  myReplies: {
    totalCount: number
    edges: Array<{
      node: {
        id: string
        text: string | null
        type: ReplyTypeEnum
        createdAt: string | null
        articleReplies: Array<{
          articleId: string
          positiveFeedbackCount: number
        }>
      }
    }>
  } | null
  myFeedbacks: {
    totalCount: number
    edges: Array<{
      node: {
        id: string
        vote: FeedbackVote | null
        createdAt: string | null
        article: {
          id: string
          text: string | null
          articleType: ArticleTypeEnum
        } | null
      }
    }>
  } | null
}

export type GetContributionSuggestionsQueryVariables = Exact<{
  userId: string
}>

export type GetContributionSuggestionsQuery = {
  upvotesReceived: { totalCount: number } | null
  toRate: {
    edges: Array<{
      node: {
        id: string
        text: string | null
        replyRequests: Array<{ userId: string | null } | null> | null
        articleReplies: Array<{
          replyId: string
          userId: string
          ownVote: FeedbackVote | null
          feedbackCount: number
          replyType: ReplyTypeEnum | null
          reply: { text: string | null } | null
        }>
      }
    }>
  } | null
  toWrite: {
    edges: Array<{
      node: {
        id: string
        text: string | null
        replyRequestCount: number | null
        replyRequests: Array<{ userId: string | null } | null> | null
      }
    }>
  } | null
}

export type VoteOnReplyMutationVariables = Exact<{
  articleId: string
  replyId: string
  vote: FeedbackVote
}>

export type VoteOnReplyMutation = {
  CreateOrUpdateArticleReplyFeedback: {
    replyId: string
    ownVote: FeedbackVote | null
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
export const GetMyContributionsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetMyContributions' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'since' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String' },
            },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'first' },
          },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
          },
        },
      ],
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
                { kind: 'Field', name: { kind: 'Name', value: 'level' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'points' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'total' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'currentLevel' },
                      },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'nextLevel' },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'contributions' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'dateRange' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'GTE' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'since' },
                            },
                          },
                        ],
                      },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'date' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'count' } },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'myReports' },
            name: { kind: 'Name', value: 'ListReplyRequests' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'selfOnly' },
                      value: { kind: 'BooleanValue', value: true },
                    },
                  ],
                },
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
                          name: { kind: 'Name', value: 'createdAt' },
                          value: { kind: 'EnumValue', value: 'DESC' },
                        },
                      ],
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'first' },
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
                              name: { kind: 'Name', value: 'reason' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'createdAt' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'article' },
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
                                    name: {
                                      kind: 'Name',
                                      value: 'articleType',
                                    },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'replyCount' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: {
                                      kind: 'Name',
                                      value: 'articleReplies',
                                    },
                                    arguments: [
                                      {
                                        kind: 'Argument',
                                        name: { kind: 'Name', value: 'status' },
                                        value: {
                                          kind: 'EnumValue',
                                          value: 'NORMAL',
                                        },
                                      },
                                    ],
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        {
                                          kind: 'Field',
                                          name: {
                                            kind: 'Name',
                                            value: 'replyId',
                                          },
                                        },
                                        {
                                          kind: 'Field',
                                          name: {
                                            kind: 'Name',
                                            value: 'userId',
                                          },
                                        },
                                        {
                                          kind: 'Field',
                                          name: {
                                            kind: 'Name',
                                            value: 'ownVote',
                                          },
                                        },
                                        {
                                          kind: 'Field',
                                          name: {
                                            kind: 'Name',
                                            value: 'feedbackCount',
                                          },
                                        },
                                        {
                                          kind: 'Field',
                                          name: {
                                            kind: 'Name',
                                            value: 'replyType',
                                          },
                                        },
                                        {
                                          kind: 'Field',
                                          name: {
                                            kind: 'Name',
                                            value: 'reply',
                                          },
                                          selectionSet: {
                                            kind: 'SelectionSet',
                                            selections: [
                                              {
                                                kind: 'Field',
                                                name: {
                                                  kind: 'Name',
                                                  value: 'text',
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
                  },
                },
              ],
            },
          },
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'myReplies' },
            name: { kind: 'Name', value: 'ListReplies' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'selfOnly' },
                      value: { kind: 'BooleanValue', value: true },
                    },
                  ],
                },
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
                          name: { kind: 'Name', value: 'createdAt' },
                          value: { kind: 'EnumValue', value: 'DESC' },
                        },
                      ],
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'first' },
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
                              name: { kind: 'Name', value: 'type' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'createdAt' },
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
                                    name: { kind: 'Name', value: 'articleId' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: {
                                      kind: 'Name',
                                      value: 'positiveFeedbackCount',
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
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'myFeedbacks' },
            name: { kind: 'Name', value: 'ListArticleReplyFeedbacks' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'selfOnly' },
                      value: { kind: 'BooleanValue', value: true },
                    },
                  ],
                },
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
                          name: { kind: 'Name', value: 'createdAt' },
                          value: { kind: 'EnumValue', value: 'DESC' },
                        },
                      ],
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'first' },
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
                              name: { kind: 'Name', value: 'vote' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'createdAt' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'article' },
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
                                    name: {
                                      kind: 'Name',
                                      value: 'articleType',
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
      },
    },
  ],
} as unknown as DocumentNode<
  GetMyContributionsQuery,
  GetMyContributionsQueryVariables
>
export const GetContributionSuggestionsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetContributionSuggestions' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'userId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'upvotesReceived' },
            name: { kind: 'Name', value: 'ListArticleReplyFeedbacks' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'authorId' },
                      value: {
                        kind: 'Variable',
                        name: { kind: 'Name', value: 'userId' },
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'vote' },
                      value: {
                        kind: 'ListValue',
                        values: [{ kind: 'EnumValue', value: 'UPVOTE' }],
                      },
                    },
                  ],
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'totalCount' } },
              ],
            },
          },
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'toRate' },
            name: { kind: 'Name', value: 'ListArticles' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'articleTypes' },
                      value: {
                        kind: 'ListValue',
                        values: [{ kind: 'EnumValue', value: 'TEXT' }],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'replyCount' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'GTE' },
                            value: { kind: 'IntValue', value: '1' },
                          },
                        ],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: {
                        kind: 'Name',
                        value: 'hasArticleReplyWithMorePositiveFeedback',
                      },
                      value: { kind: 'BooleanValue', value: false },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'articleRepliesFrom' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'userId' },
                            value: {
                              kind: 'Variable',
                              name: { kind: 'Name', value: 'userId' },
                            },
                          },
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'exists' },
                            value: { kind: 'BooleanValue', value: false },
                          },
                        ],
                      },
                    },
                  ],
                },
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
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '6' },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
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
                              name: { kind: 'Name', value: 'replyRequests' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'userId' },
                                  },
                                ],
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
                                    name: { kind: 'Name', value: 'replyId' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'userId' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'ownVote' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: {
                                      kind: 'Name',
                                      value: 'feedbackCount',
                                    },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'replyType' },
                                  },
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'reply' },
                                    selectionSet: {
                                      kind: 'SelectionSet',
                                      selections: [
                                        {
                                          kind: 'Field',
                                          name: { kind: 'Name', value: 'text' },
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
          {
            kind: 'Field',
            alias: { kind: 'Name', value: 'toWrite' },
            name: { kind: 'Name', value: 'ListArticles' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'articleTypes' },
                      value: {
                        kind: 'ListValue',
                        values: [{ kind: 'EnumValue', value: 'TEXT' }],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'replyCount' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'EQ' },
                            value: { kind: 'IntValue', value: '0' },
                          },
                        ],
                      },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'replyRequestCount' },
                      value: {
                        kind: 'ObjectValue',
                        fields: [
                          {
                            kind: 'ObjectField',
                            name: { kind: 'Name', value: 'GTE' },
                            value: { kind: 'IntValue', value: '2' },
                          },
                        ],
                      },
                    },
                  ],
                },
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
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'first' },
                value: { kind: 'IntValue', value: '6' },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
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
                              name: {
                                kind: 'Name',
                                value: 'replyRequestCount',
                              },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'replyRequests' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'Field',
                                    name: { kind: 'Name', value: 'userId' },
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
} as unknown as DocumentNode<
  GetContributionSuggestionsQuery,
  GetContributionSuggestionsQueryVariables
>
export const VoteOnReplyDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'mutation',
      name: { kind: 'Name', value: 'VoteOnReply' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'articleId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String' },
            },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'replyId' },
          },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'String' },
            },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'vote' } },
          type: {
            kind: 'NonNullType',
            type: {
              kind: 'NamedType',
              name: { kind: 'Name', value: 'FeedbackVote' },
            },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'CreateOrUpdateArticleReplyFeedback' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'articleId' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'articleId' },
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'replyId' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'replyId' },
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'vote' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'vote' },
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'replyId' } },
                { kind: 'Field', name: { kind: 'Name', value: 'ownVote' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<VoteOnReplyMutation, VoteOnReplyMutationVariables>
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
