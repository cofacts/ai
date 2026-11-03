"""Where the Cofacts website lives, for building links out of article ids.

DEMO BRANCH: this is pinned to the **staging** site on purpose. Every deployment
of cofacts.ai — local, PR preview and master — talks to `dev-api.cofacts.tw`
(`.env.example`, and `COFACTS_API_URL` in the deploy workflow), so an article we
just created is only reachable at `dev.cofacts.tw`; a `cofacts.tw` link would
404 in front of the person we just asked to trust us.

Before this reaches production, this should read an env var set alongside
`COFACTS_API_URL` rather than being a constant, so the site and the API can
never disagree about which Cofacts they mean.
"""

COFACTS_SITE_URL = "https://dev.cofacts.tw"


def article_url(article_id: str) -> str:
    """The page a human can open to read one suspicious message."""
    return f"{COFACTS_SITE_URL}/article/{article_id}"
