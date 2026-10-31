// Type-safe GraphQL executor for rumors-api. Takes a TypedDocumentNode produced
// by graphql-codegen's client preset and returns a typed result. Reads the
// HttpOnly session cookie when available — token is optional so unauthenticated
// queries work — and forwards the JWT as Bearer auth.
//
// rumors-api rejects the whole request (HTTP 500, before any resolver runs) when the
// Bearer token is invalid or expired, even for public queries. Then this retries once
// without the token, so public pages keep working with a stale cookie.
//
// On network error, non-2xx response, or GraphQL `errors` array, this throws.
// Callers that want a soft-fail wrap the call in try/catch and handle null /
// partial data themselves.
//
// Server-only (the .server.ts suffix makes TanStack Start's import protection
// enforce it): use it only inside createServerFn handlers.

import { getCookie } from '@tanstack/react-start/server'
import { print } from 'graphql'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'

import { getApiBase } from '@/server/api-base'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

interface GraphQLResponse<TResult> {
  data?: TResult | null
  errors?: ReadonlyArray<{ message: string }>
}

const INVALID_TOKEN = /Invalid or expired Bearer token/

export async function cofactsExec<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables,
): Promise<TResult> {
  const token = getCookie(SESSION_COOKIE_NAME)
  const body = JSON.stringify({ query: print(document), variables })
  const post = (withToken: boolean) =>
    fetch(`${getApiBase()}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': 'RUMORS_SITE',
        ...(withToken && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    })

  let res = await post(true)
  if (!res.ok && token && (await rejectsToken(res))) {
    res = await post(false)
  }

  if (!res.ok) {
    throw new Error(`cofacts-api responded ${res.status}`)
  }

  const result = (await res.json()) as GraphQLResponse<TResult>
  if (result.errors && result.errors.length > 0) {
    throw new Error(
      result.errors[0]?.message ?? 'cofacts-api returned an error',
    )
  }
  if (result.data == null) {
    throw new Error('cofacts-api returned no data')
  }
  return result.data
}

async function rejectsToken(res: Response): Promise<boolean> {
  try {
    const { errors } = (await res.json()) as GraphQLResponse<unknown>
    return !!errors?.some((e) => INVALID_TOKEN.test(e.message))
  } catch {
    return false
  }
}
