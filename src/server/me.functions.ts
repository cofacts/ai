// TanStack Start server function exposing the current logged-in user's
// profile to the client. Dispatches the GetUser GraphQL query through
// cofactsExec — nothing more.
//
// This is a pure profile fetch, not an auth gate: whether the session is
// authenticated is decided solely by getAuthStatusServerFn
// (auth.status.functions.ts), which verifies the JWT and never calls
// rumors-api. A `null` return here means "profile unavailable" (GetUser
// failed or returned nothing) — it does NOT mean "logged out", so callers
// must not use it as an auth signal.

import { createServerFn } from '@tanstack/react-start'

import { graphql } from './gql'
import type { GetCurrentUserQuery } from './gql/graphql'
import { cofactsExec } from '@/lib/cofactsExec'

export type CofactsUser = NonNullable<GetCurrentUserQuery['GetUser']>

const GetCurrentUserDocument = graphql(`
  query GetCurrentUser {
    GetUser {
      id
      name
      avatarUrl
      avatarType
      avatarData
    }
  }
`)

export const getCurrentUserServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CofactsUser | null> => {
    try {
      const data = await cofactsExec(GetCurrentUserDocument)
      return data.GetUser ?? null
    } catch {
      return null
    }
  },
)
