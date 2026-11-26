// TanStack Start server function that submits the user's fact-check reply to Cofacts.
//
// The reply is created by rumors-api's CreateReply mutation as the logged-in user: cofactsExec
// forwards the HttpOnly session cookie's JWT as Bearer auth, so the reply is attributed to the
// user, not to Cofacts.ai. CreateReply links the new reply to the first article; when the draft
// answers several articles, CreateArticleReply links the same reply to each of the others.
//
// getMyArticleReplies tells the drawer which target articles the user has already replied to.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { parse } from 'graphql'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'

import type { ReplyCategory } from '@/lib/factCheckDraft'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import {
  MAX_REPLY_ARTICLES,
  draftSubmitProblem,
  isReplyCategory,
} from '@/lib/factCheckDraft'
import { cofactsExec } from '@/server/cofacts.server'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

interface CreateReplyResult {
  CreateReply: { id: string } | null
}

interface CreateReplyVariables {
  articleId: string
  text: string
  type: ReplyCategory
  reference?: string
}

// Hand-typed like articles.functions.ts: one mutation, no schema regeneration needed.
const CreateReplyDocument = parse(`
  mutation CreateReplyFromAi(
    $articleId: String!
    $text: String!
    $type: ReplyTypeEnum!
    $reference: String
  ) {
    CreateReply(
      articleId: $articleId
      text: $text
      type: $type
      reference: $reference
    ) {
      id
    }
  }
`) as unknown as TypedDocumentNode<CreateReplyResult, CreateReplyVariables>

interface CreateArticleReplyResult {
  CreateArticleReply: Array<{ articleId: string }> | null
}

const CreateArticleReplyDocument = parse(`
  mutation LinkReplyFromAi($articleId: String!, $replyId: String!) {
    CreateArticleReply(articleId: $articleId, replyId: $replyId) {
      articleId
    }
  }
`) as unknown as TypedDocumentNode<
  CreateArticleReplyResult,
  { articleId: string; replyId: string }
>

interface MyArticleRepliesResult {
  GetArticle: {
    articleReplies: Array<{ replyId: string }>
  } | null
}

/** The query key's operation name; per user, so `clearUserScopedCache` removes it on logout. */
export const MY_ARTICLE_REPLIES_QUERY = 'MyArticleRepliesForAi'

// selfOnly: only the logged-in user's replies; NORMAL: not the ones they deleted.
const MyArticleRepliesDocument = parse(`
  query MyArticleRepliesForAi($id: String!) {
    GetArticle(id: $id) {
      articleReplies(selfOnly: true, statuses: [NORMAL]) {
        replyId
      }
    }
  }
`) as unknown as TypedDocumentNode<MyArticleRepliesResult, { id: string }>

function validArticleIds(articleIds: unknown): Array<string> {
  if (
    !Array.isArray(articleIds) ||
    articleIds.length === 0 ||
    articleIds.length > MAX_REPLY_ARTICLES ||
    !articleIds.every((id) => typeof id === 'string' && id)
  )
    throw new Error('Invalid articleIds')
  return [...new Set(articleIds as Array<string>)]
}

// rumors-api's AUTH_ERROR_MSG (src/util/user.ts). Update together.
const NOT_LOGGED_IN = /userId is not set/

export interface SubmitReplyInput {
  /** The reply is created on the first and linked to the rest. */
  articleIds: Array<string>
  classification: ReplyCategory
  text: string
  references: string
}

export const submitFactCheckReply = createServerFn({ method: 'POST' })
  .inputValidator((input: SubmitReplyInput): SubmitReplyInput => {
    const articleIds = validArticleIds(input.articleIds)
    if (!isReplyCategory(input.classification))
      throw new Error('Invalid classification')
    const problem = draftSubmitProblem(input)
    if (problem) throw new Error(problem)
    return { ...input, articleIds }
  })
  .handler(
    async ({
      data,
    }): Promise<{ replyId: string; unlinkedArticleIds: Array<string> }> => {
      if (!getCookie(SESSION_COOKIE_NAME)) throw new Error(AUTH_EXPIRED_MESSAGE)

      let result: CreateReplyResult
      try {
        result = await cofactsExec(CreateReplyDocument, {
          articleId: data.articleIds[0]!,
          text: data.text.trim(),
          type: data.classification,
          reference:
            data.classification === 'NOT_ARTICLE' && !data.references.trim()
              ? undefined
              : data.references.trim(),
        })
      } catch (err) {
        // cofactsExec drops a token rumors-api rejects and retries anonymously, which then fails
        // CreateReply's login check (`assertUser` in rumors-api src/util/user.ts throws
        // AUTH_ERROR_MSG): the session is gone, so ask the user to log in again.
        if (err instanceof Error && NOT_LOGGED_IN.test(err.message))
          throw new Error(AUTH_EXPIRED_MESSAGE)
        throw err
      }
      const replyId = result.CreateReply?.id
      if (!replyId) throw new Error('Cofacts 沒有回傳新的回應 ID')

      // The reply exists now, so a failed link must not look like a failed submit (the user would
      // submit again and create a second reply); report which articles are missing it instead.
      const unlinkedArticleIds: Array<string> = []
      for (const articleId of data.articleIds.slice(1)) {
        try {
          await cofactsExec(CreateArticleReplyDocument, { articleId, replyId })
        } catch {
          unlinkedArticleIds.push(articleId)
        }
      }
      return { replyId, unlinkedArticleIds }
    },
  )

/** For each article, the ids of the logged-in user's own (not deleted) replies to it. */
export const getMyArticleReplies = createServerFn({ method: 'GET' })
  .inputValidator((articleIds: Array<string>) => validArticleIds(articleIds))
  .handler(
    async ({ data: articleIds }): Promise<Record<string, Array<string>>> => {
      if (!getCookie(SESSION_COOKIE_NAME)) return {}
      const entries = await Promise.all(
        articleIds.map(async (id) => {
          const result = await cofactsExec(MyArticleRepliesDocument, { id })
          const replyIds = (result.GetArticle?.articleReplies ?? []).map(
            (ar) => ar.replyId,
          )
          return [id, replyIds] as const
        }),
      )
      return Object.fromEntries(entries)
    },
  )
