// Where a Cofacts article can be read by a human.
//
// Every deployment currently points COFACTS_API_URL at dev-api.cofacts.tw, so an
// article this app just created lives on dev.cofacts.tw. Handing that reporter a
// cofacts.tw link would 404 — the one place a broken link is least affordable,
// since we just asked them to trust us with something they found suspicious.
//
// The site URL is derived from the API URL rather than hardcoded, so the two can
// never drift apart:
//
//   https://dev-api.cofacts.tw  ->  https://dev.cofacts.tw
//   https://api.cofacts.tw      ->  https://cofacts.tw
//
// The derivation is a convention, not a guarantee, so COFACTS_SITE_URL overrides
// it outright for any deployment that does not follow the pattern.
//
// Server-only: depends on getApiBase(), which reads process.env.

import { getApiBase } from './api-base'

/**
 * Strips the API subdomain from a hostname.
 *
 * `api.` is dropped entirely; a prefixed form like `dev-api.` keeps its prefix
 * (`dev.`). A hostname matching neither is returned unchanged, which is the
 * right answer for a deployment that does not follow the convention — and the
 * reason COFACTS_SITE_URL exists.
 */
function apiHostToSiteHost(host: string): string {
  const withPrefix = /^([^.]+)-api\.(.+)$/.exec(host)
  if (withPrefix) return `${withPrefix[1]}.${withPrefix[2]}`
  if (host.startsWith('api.')) return host.slice('api.'.length)
  return host
}

/** Base URL of the Cofacts website, with no trailing slash. */
export function getSiteBase(): string {
  const override = process.env.COFACTS_SITE_URL
  if (override) return override.replace(/\/+$/, '')

  const api = new URL(getApiBase())
  api.hostname = apiHostToSiteHost(api.hostname)
  return api.origin
}

/** Public URL of one Cofacts article — what we show and hand to the writer. */
export function getArticleUrl(articleId: string): string {
  return `${getSiteBase()}/article/${articleId}`
}
