// Cofacts rumors-api base URL for server-side BFF code only.
//
// Resolved from the `COFACTS_API_URL` env var at process start. Missing
// env throws on import — no silent fallback that could mask misconfigured
// staging/prod deployments. This module must only be imported from
// server-side code (`src/server/*`, `src/routes/api/*`); the client never
// talks to rumors-api directly under the BFF model — it goes through
// `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout` and
// `/api/graphql` instead.
//
// Trailing slashes are stripped so callers can safely concatenate paths
// (e.g. `${API_BASE}/graphql`) without producing `//graphql`.

function resolveApiBase(): string {
  const raw = process.env.COFACTS_API_URL;
  if (!raw) {
    throw new Error(
      'COFACTS_API_URL env var is required (rumors-api base URL).',
    );
  }
  return raw.replace(/\/+$/, '');
}

export const API_BASE = resolveApiBase();
