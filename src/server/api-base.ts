// Cofacts rumors-api base URL for server-side BFF code only.
//
// Resolved from the `COFACTS_API_URL` env var on first call. Missing env
// throws at the call site, not at import — so this module can sit on import
// graphs that the client touches (e.g. via server functions whose top-level
// imports get statically analyzed) without crashing client hydration.
//
// Trailing slashes are stripped so callers can safely concatenate paths
// (e.g. `${getApiBase()}/graphql`) without producing `//graphql`.

export function getApiBase(): string {
  const raw = process.env.COFACTS_API_URL
  if (!raw) {
    throw new Error(
      'COFACTS_API_URL env var is required (rumors-api base URL).',
    )
  }
  return raw.replace(/\/+$/, '')
}
