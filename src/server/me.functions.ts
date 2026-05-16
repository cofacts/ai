// TanStack Start server function exposing the current logged-in user to the
// client. Reads the HttpOnly cofacts_session cookie via h3's getCookie and
// dispatches the GetUser GraphQL query through cofactsExec. If GetUser fails
// (upstream down, transient error) but a valid session cookie exists, falls
// back to a minimal user derived from the JWT sub claim so the app keeps
// showing the authenticated shell; the full profile will load on next SSR.
// Returns null only when there is definitely no valid session at all.

import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'

import { cofactsExec } from '@/lib/cofactsExec'
import { graphql } from './gql'
import type { GetCurrentUserQuery } from './gql/graphql'
import { verifySessionToken } from './jwt'
import { SESSION_COOKIE_NAME } from './sessionCookie'

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
