// TanStack Start server function that fetches a Cofacts article's full-size
// attachment URL on demand.
//
// The agent's get_single_cofacts_article tool rewrites attachmentUrl to a
// gs:// URI (non-expiring, Vertex-native) which a browser cannot load, so the
// UI must not use that value directly. Instead the RightDrawer asks this
// function for a fresh, browser-loadable signed HTTPS URL, fetched straight
// from rumors-api's GetArticle(attachmentUrl(variant: ORIGINAL)).

import { createServerFn } from '@tanstack/react-start'
import { parse } from 'graphql'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'

import { cofactsExec } from '@/lib/cofactsExec'

interface GetArticleAttachmentResult {
  GetArticle: { attachmentUrl: string | null } | null
}

interface GetArticleAttachmentVariables {
  id: string
}

// Hand-typed document rather than the codegen `graphql()` helper: this single
// query needs no schema regeneration, and cofactsExec only requires a printable
// TypedDocumentNode. variant: ORIGINAL returns the full-size media (not the
// PREVIEW the agent fetches) as a freshly signed, short-lived HTTPS URL.
const GetArticleAttachmentDocument = parse(`
  query GetArticleAttachment($id: String!) {
    GetArticle(id: $id) {
      attachmentUrl(variant: ORIGINAL)
    }
  }
`) as unknown as TypedDocumentNode<
  GetArticleAttachmentResult,
  GetArticleAttachmentVariables
>

export const getArticleAttachmentUrl = createServerFn({ method: 'GET' })
  .inputValidator((articleId: string) => articleId)
  .handler(async ({ data: articleId }): Promise<string | null> => {
    const data = await cofactsExec(GetArticleAttachmentDocument, {
      id: articleId,
    })
    return data.GetArticle?.attachmentUrl ?? null
  })
