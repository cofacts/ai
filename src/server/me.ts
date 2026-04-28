// Server-only helper to fetch the current user from rumors-api given a JWT.
// Pure fetch wrapper with no framework coupling — TanStack server fns
// (me.functions.ts) handle cookie reading and call into this module.
//
// All error paths (network failure, non-2xx, GraphQL errors, missing user)
// resolve to `null` rather than throwing — the calling layer treats "no user"
// as the unauthenticated state and renders accordingly.

import { API_BASE } from './api-base';

export type AvatarType = 'OpenPeeps' | 'Gravatar' | 'Facebook' | 'Github';

export interface CofactsUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarType: AvatarType | null;
  avatarData: string | null;
}

interface GetUserGraphQLResponse {
  data?: { GetUser: CofactsUser | null } | null;
  errors?: unknown;
}

const GET_USER_QUERY =
  '{ GetUser { id name avatarUrl avatarType avatarData } }';

export async function fetchMeWithToken(
  token: string,
): Promise<CofactsUser | null> {
  try {
    const res = await fetch(`${API_BASE}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-app-id': 'RUMORS_SITE',
      },
      body: JSON.stringify({ query: GET_USER_QUERY }),
    });

    if (res.status === 401) return null;
    if (!res.ok) return null;

    const data = (await res.json()) as GetUserGraphQLResponse;
    if (data.errors) return null;
    const user = data.data?.GetUser;
    if (!user) return null;
    return user;
  } catch {
    return null;
  }
}
