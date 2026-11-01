// Type-safe GraphQL executor for rumors-api. Takes a TypedDocumentNode produced
// by graphql-codegen's client preset and returns a typed result. Reads the
// HttpOnly session cookie when available — token is optional so unauthenticated
// queries work — and forwards the JWT as Bearer auth.
//
// rumors-api rejects the whole request (HTTP 500, before any resolver runs) when the
// Bearer token is invalid or expired, even for public queries. That session is dead, so
// this clears the session cookie and retries once without the token: the page renders
// logged out instead of failing, and later requests no longer carry the rejected token.
// Other failures (network, 5xx, rate limit) are not treated as a dead session. See
// docs/decisions/20261101-ssr-rejected-session-token.md.
//
// On network error, non-2xx response, or GraphQL `errors` array, this throws.
// Callers that want a soft-fail wrap the call in try/catch and handle null /
// partial data themselves.
//
// Server-only (the .server.ts suffix makes TanStack Start's import protection
// enforce it): use it only inside createServerFn handlers.

import { deleteCookie, getCookie } from '@tanstack/react-start/server'
import { print } from 'graphql'
import type { TypedDocumentNode } from '@graphql-typed-document-node/core'

import { getApiBase } from '@/server/api-base'
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieAttrs,
} from '@/server/sessionCookie'

interface GraphQLResponse<TResult> {
  data?: TResult | null
  errors?: ReadonlyArray<{ message: string }>
}

// Must match the message rumors-api throws when a Bearer token fails JWT verification:
// `throw new Error('Invalid or expired Bearer token')` in cofacts/rumors-api
// src/contextFactory.ts (covered by src/__tests__/contextFactory-bearer.test.js there).
// It arrives wrapped, e.g. "Context creation failed: Invalid or expired Bearer token". If the
// text changes there, update this regex, or a dead session stops being detected and pages
// fail again.
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
    deleteCookie(SESSION_COOKIE_NAME, buildClearSessionCookieAttrs())
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
