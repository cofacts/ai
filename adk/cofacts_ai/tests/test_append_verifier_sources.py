"""Unit tests for `append_verifier_sources`, the after-model callback that
builds ai_verifier's `sources` list.

`sources` is the union of (a) pages url-resolver actually resolved --
recorded by `inject_resolved_url_content` in
`callback_context.state["temp:cofacts_resolved_meta"]`, since this callback
only sees the LlmResponse and cannot see what the before-model callback
injected into the request -- and (b) url_context's grounding_chunks. This is
what makes a dead URL structurally unable to become a citable source without
a hard-coded ban list: it's fetched by neither path, so it appears in
neither and is silently absent from `sources`.

The basic union -- a resolved page listed, a url_context-grounded page
url-resolver could not fetch listed, a dead link absent -- is pinned end to
end in `test_verifier_round_trip.py`. The tests here cover what that one call
does not construct: a canonical that differs from the requested URL, the two
paths naming the same page, no grounding at all, and an empty reply.
"""

from types import SimpleNamespace
from typing import cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_response import LlmResponse
from google.genai import types as genai_types

from cofacts_ai.agent import append_verifier_sources
from cofacts_ai.resolved_pages import RESOLVED_META_STATE_KEY


def make_context(resolved_meta: dict | None = None) -> CallbackContext:
    return cast(
        CallbackContext,
        SimpleNamespace(state={RESOLVED_META_STATE_KEY: resolved_meta or {}}),
    )


def make_response(
    text: str = "report", grounding_chunks: list | None = None
) -> LlmResponse:
    metadata = None
    if grounding_chunks is not None:
        metadata = SimpleNamespace(grounding_chunks=grounding_chunks)
    return LlmResponse(
        content=genai_types.Content(role="model", parts=[genai_types.Part(text=text)]),
        grounding_metadata=metadata,
    )


def web_chunk(url: str, title: str = "Chunk Title"):
    return SimpleNamespace(web=SimpleNamespace(uri=url, title=title))


def sources_of(llm_response: LlmResponse) -> list[dict]:
    import json

    assert llm_response.content is not None
    assert llm_response.content.parts is not None
    text = llm_response.content.parts[0].text
    assert text is not None
    payload = json.loads(text)
    return payload["sources"]


class TestAppendVerifierSources:
    async def test_lists_the_requested_url_not_a_homepage_canonical(self):
        """og:url often points at the site's homepage. Listing it would have
        the published reply cite `https://news.example/` instead of the article
        the verifier actually checked."""
        article = "https://news.example/2026/07/article-123"
        context = make_context(
            {
                article: {
                    "status": "resolved",
                    "title": "Article",
                    "canonical": "https://news.example/",
                }
            }
        )
        response = make_response(grounding_chunks=[])

        result = await append_verifier_sources(context, response)

        assert result is not None
        assert sources_of(result) == [{"title": "Article", "url": article}]

    async def test_union_dedups_by_url_preferring_resolver_title(self):
        context = make_context(
            {
                "https://a.com": {
                    "status": "resolved",
                    "title": "Resolver Title",
                    "canonical": "https://a.com",
                }
            }
        )
        response = make_response(
            grounding_chunks=[web_chunk("https://a.com", "Grounding Title")]
        )

        result = await append_verifier_sources(context, response)

        assert result is not None
        sources = sources_of(result)
        assert len(sources) == 1
        assert sources[0]["title"] == "Resolver Title"

    async def test_dedups_when_canonical_differs_from_requested_url(self):
        """One page, one entry -- even when url_context grounds it under its
        canonical. A page that redirects (or declares a different canonical)
        is the same page under two names, and must not be presented to a
        reader as two sources. It is listed under the requested URL.
        """
        context = make_context(
            {
                "https://a.com/?utm_source=line": {
                    "status": "resolved",
                    "title": "Resolver Title",
                    "canonical": "https://a.com/article",
                }
            }
        )
        response = make_response(
            grounding_chunks=[web_chunk("https://a.com/article", "Grounding Title")]
        )

        result = await append_verifier_sources(context, response)

        assert result is not None
        sources = sources_of(result)
        assert len(sources) == 1
        assert sources[0]["url"] == "https://a.com/?utm_source=line"
        assert sources[0]["title"] == "Resolver Title"

    async def test_wraps_response_even_without_grounding_metadata(self):
        # A lazy/misbehaving model that skipped url_context should not also
        # lose the deterministically-fetched resolver sources.
        context = make_context(
            {
                "https://a.com": {
                    "status": "resolved",
                    "title": "A",
                    "canonical": "https://a.com",
                }
            }
        )
        response = make_response(grounding_chunks=None)

        result = await append_verifier_sources(context, response)

        assert result is not None
        assert sources_of(result) == [{"title": "A", "url": "https://a.com"}]

    async def test_no_content_returns_none(self):
        context = make_context({})
        response = LlmResponse(content=None, grounding_metadata=None)

        result = await append_verifier_sources(context, response)

        assert result is None

    async def test_empty_text_returns_none_so_the_empty_retry_fires(self):
        # Wrapping "" as {"content": "", ...} would hide the empty response from
        # the writer's empty-response retry.
        context = make_context({"https://a.com": {"status": "resolved", "title": "A"}})
        response = make_response(text="  \n", grounding_chunks=[])

        result = await append_verifier_sources(context, response)

        assert result is None

    async def test_preserves_report_text(self):
        context = make_context({})
        response = make_response(text="✓ Supported: ...", grounding_chunks=[])

        result = await append_verifier_sources(context, response)

        assert result is not None
        assert result.content is not None
        assert result.content.parts is not None
        text = result.content.parts[0].text
        assert text is not None
        import json

        payload = json.loads(text)
        assert payload["content"] == "✓ Supported: ..."
