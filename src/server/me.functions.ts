// TanStack Start server function exposing the current logged-in user to the
// client. Reads the HttpOnly cofacts_session cookie via h3's getCookie and
// dispatches the GetUser GraphQL query through cofactsExec. Always resolves —
// never throws — so loaders and effects can call it without try/catch
// boilerplate; cofactsExec throws are caught here and mapped to null.

import { createServerFn } from '@tanstack/react-start'

import { cofactsExec } from '@/lib/cofactsExec'
import { graphql } from './gql'
import type { GetCurrentUserQuery } from './gql/graphql'

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
