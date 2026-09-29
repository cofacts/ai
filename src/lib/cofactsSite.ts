/**
 * Where the Cofacts website lives, for the links this app renders out to it.
 *
 * DEMO BRANCH: pinned to the **staging** site on purpose. Every deployment of
 * cofacts.ai — local, PR preview and master — talks to `dev-api.cofacts.tw`
 * (see `.env.example` and `COFACTS_API_URL` in the deploy workflow), so the
 * articles we link to only exist on `dev.cofacts.tw`; a `cofacts.tw` link would
 * 404. Mirrors `adk/cofacts_ai/cofacts_site.py`, which the agents use.
 *
 * Before this reaches production it should come from the same configuration as
 * `COFACTS_API_URL` instead of being a constant, so the site and the API can
 * never disagree about which Cofacts they mean.
 */
export const COFACTS_SITE_URL = 'https://dev.cofacts.tw'

/** The page a human can open to read one suspicious message. */
export function cofactsArticleUrl(articleId: string): string {
  return `${COFACTS_SITE_URL}/article/${articleId}`
}
