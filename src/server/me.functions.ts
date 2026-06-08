// TanStack Start server function exposing the current logged-in user to the
// client. Reads the HttpOnly cofacts_session cookie via h3's getCookie and
// dispatches the GetUser GraphQL query through cofactsExec.
//
// When GetUser throws but the session cookie is a valid JWT, returns a
// minimal user populated from the JWT sub so AuthProvider's `['me']` query
// (initialData + staleTime: Infinity) stays truthy and _app.tsx's `!user`
// gate keeps rendering the authenticated shell. name/avatar remain null
// until cache invalidation or a subsequent successful fetch. Returns null
// only when no valid session cookie exists.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

import { graphql } from './gql'
import { verifySessionToken } from './jwt'
import { SESSION_COOKIE_NAME } from './sessionCookie'
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
      const token = getCookie(SESSION_COOKIE_NAME)
      if (token) {
        try {
          const { userId } = await verifySessionToken(token)
          return {
            id: userId,
            name: null,
            avatarUrl: null,
            avatarType: null,
            avatarData: null,
          }
        } catch {
          // JWT also invalid — truly logged out
        }
      }
      return null
    }
  },
)
