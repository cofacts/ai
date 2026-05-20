// Type-safe GraphQL executor for rumors-api. Takes a TypedDocumentNode produced
// by graphql-codegen's client preset and returns a typed result. Reads the
// HttpOnly session cookie when available — token is optional so unauthenticated
// queries work — and forwards the JWT as Bearer auth.
//
// On network error, non-2xx response, or GraphQL `errors` array, this throws.
// Callers that want a soft-fail wrap the call in try/catch and handle null /
// partial data themselves.
//
// Server-only: depends on h3's getCookie via @tanstack/react-start/server. Do
// not import from client code.

import type { TypedDocumentNode } from '@graphql-typed-document-node/core'
import { getCookie } from '@tanstack/react-start/server'
import { print } from 'graphql'

import { getApiBase } from '@/server/api-base'
import { SESSION_COOKIE_NAME } from '@/server/sessionCookie'

interface GraphQLResponse<TResult> {
  data?: TResult | null
  errors?: ReadonlyArray<{ message: string }>
}

export async function cofactsExec<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables,
): Promise<TResult> {
  const token = getCookie(SESSION_COOKIE_NAME)

  const res = await fetch(`${getApiBase()}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-id': 'RUMORS_SITE',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: print(document),
      variables,
    }),
  })

  if (!res.ok) {
    throw new Error(`cofacts-api responded ${res.status}`)
  }

  const body = (await res.json()) as GraphQLResponse<TResult>
  if (body.errors && body.errors.length > 0) {
    throw new Error(body.errors[0].message)
  }
  if (body.data == null) {
    throw new Error('cofacts-api returned no data')
  }
  return body.data
}
