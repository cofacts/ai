// Cofacts rumors-api base URL for server-side BFF code only.
//
// Resolved from the `API_URL` env var at process start, with a hardcoded
// fallback for local development. This module must only be imported from
// server-side code (`src/server/*`, `src/routes/api/*`); the client never
// talks to rumors-api directly under the BFF model — it goes through
// `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` and
// `/api/graphql` instead.
//
// Trailing slashes are stripped so callers can safely concatenate paths
// (e.g. `${API_BASE}/graphql`) without producing `//graphql`.

const DEFAULT_API_URL = 'https://dev-api-db-v9.cofacts.tw';

function resolveApiBase(): string {
  const raw = process.env.API_URL ?? DEFAULT_API_URL;
  return raw.replace(/\/+$/, '');
}

export const API_BASE = resolveApiBase();
