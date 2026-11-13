// TanStack Start server function that submits the user's fact-check reply to Cofacts.
//
// The reply is created by rumors-api's CreateReply mutation as the logged-in user: cofactsExec
// forwards the HttpOnly session cookie's JWT as Bearer auth, so the reply is attributed to the
// user, not to Cofacts.ai. CreateReply also links the new reply to the article.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { parse } from 'graphql'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'

import type { ReplyCategory } from '@/lib/factCheckDraft'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { draftSubmitProblem, isReplyCategory } from '@/lib/factCheckDraft'
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

// rumors-api's AUTH_ERROR_MSG (src/util/user.ts). Update together.
const NOT_LOGGED_IN = /userId is not set/

export interface SubmitReplyInput {
  articleId: string
  classification: ReplyCategory
  text: string
  references: string
}

export const submitFactCheckReply = createServerFn({ method: 'POST' })
  .inputValidator((input: SubmitReplyInput): SubmitReplyInput => {
    if (!input.articleId || typeof input.articleId !== 'string')
      throw new Error('Missing articleId')
    if (!isReplyCategory(input.classification))
      throw new Error('Invalid classification')
    const problem = draftSubmitProblem(input)
    if (problem) throw new Error(problem)
    return input
  })
  .handler(async ({ data }): Promise<{ replyId: string }> => {
    if (!getCookie(SESSION_COOKIE_NAME)) throw new Error(AUTH_EXPIRED_MESSAGE)

    let result: CreateReplyResult
    try {
      result = await cofactsExec(CreateReplyDocument, {
        articleId: data.articleId,
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
    return { replyId }
  })
