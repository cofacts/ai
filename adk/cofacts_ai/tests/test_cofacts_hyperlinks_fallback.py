"""Cofacts' stored `hyperlinks` as a last-resort fallback for the verifier.

An article or reply carries the page text Cofacts' own url-resolver crawled at
`fetchedAt`. When the live fetch fails, that copy is better than nothing --
but it is evidence of what a page said *then*, so it is injected under its own
`[ARCHIVED PAGE]` marker and, critically, never counted as a source.

The data reaches the verifier through state rather than by parsing it back out
of the citation block the writer sends: see COFACTS_HYPERLINKS_STATE_KEY.
"""

from typing import cast
from unittest.mock import AsyncMock, patch

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.resolved_pages import (
    COFACTS_HYPERLINKS_STATE_KEY,
    RESOLVED_META_STATE_KEY,
    harvest_cofacts_hyperlinks,
    inject_resolved_url_content,
)
from cofacts_ai.url_resolver.client import ResolvedUrl, ResolveStatus

URL = "https://news.example.com/a"


def make_request(text: str) -> LlmRequest:
    return LlmRequest(
        contents=[genai_types.Content(role="user", parts=[genai_types.Part(text=text)])]
    )


def make_context(state: dict | None = None) -> CallbackContext:
    ctx = AsyncMock()
    ctx.state = dict(state or {})
    ctx.load_artifact = AsyncMock(return_value=None)
    ctx.save_artifact = AsyncMock(return_value=1)
    return cast(CallbackContext, ctx)


def texts(request: LlmRequest) -> list[str]:
    return [p.text for p in request.contents[0].parts or [] if p.text]


def link(url=URL, summary="舊的內文", status=200, fetched="2018-09-25T00:00:00.000Z"):
    return {
        "url": url,
        "title": "舊標題",
        "summary": summary,
        "fetchedAt": fetched,
        "status": status,
        "error": None,
    }


def unfetchable(url=URL, status=ResolveStatus.RESOLVER_CANT_FETCH):
    return ResolvedUrl(
        url=url,
        canonical=None,
        title=None,
        summary=None,
        http_status=None,
        status=status,
        error="unsupported content type",
    )


class TestHarvest:
    """The writer side: pull hyperlinks out of whatever shape the tool returned."""

    def test_harvests_from_the_article_tool_shape(self):
        ctx = make_context()
        harvest_cofacts_hyperlinks(ctx, {"article": {"hyperlinks": [link()]}})
        assert URL in ctx.state[COFACTS_HYPERLINKS_STATE_KEY]

    def test_harvests_from_the_search_tool_shape(self):
        ctx = make_context()
        harvest_cofacts_hyperlinks(
            ctx, {"data": {"edges": [{"node": {"hyperlinks": [link()]}}]}}
        )
        assert URL in ctx.state[COFACTS_HYPERLINKS_STATE_KEY]

    def test_harvests_from_nested_reply_hyperlinks(self):
        ctx = make_context()
        harvest_cofacts_hyperlinks(
            ctx,
            {
                "article": {
                    "hyperlinks": [],
                    "factCheckResponses": [
                        {"reply": {"hyperlinks": [link(url="https://reply.example/x")]}}
                    ],
                }
            },
        )
        assert "https://reply.example/x" in ctx.state[COFACTS_HYPERLINKS_STATE_KEY]

    def test_skips_links_whose_own_crawl_failed(self):
        # status 0 means Cofacts got no HTTP response -- there is no text to fall
        # back to, so keeping the entry would only produce an empty injection.
        ctx = make_context()
        harvest_cofacts_hyperlinks(ctx, {"article": {"hyperlinks": [link(status=0)]}})
        assert COFACTS_HYPERLINKS_STATE_KEY not in ctx.state

    def test_accumulates_across_tool_calls(self):
        ctx = make_context()
        harvest_cofacts_hyperlinks(ctx, {"article": {"hyperlinks": [link()]}})
        harvest_cofacts_hyperlinks(
            ctx, {"article": {"hyperlinks": [link(url="https://second.example/b")]}}
        )
        assert set(ctx.state[COFACTS_HYPERLINKS_STATE_KEY]) == {
            URL,
            "https://second.example/b",
        }


class TestArchivedFallback:
    async def test_unfetchable_url_falls_back_to_the_archived_copy(self):
        ctx = make_context({COFACTS_HYPERLINKS_STATE_KEY: {URL: link()}})
        request = make_request(f"請查核 {URL}")

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(return_value=[unfetchable()]),
        ):
            await inject_resolved_url_content(ctx, request)

        [part] = [t for t in texts(request) if t.startswith("[ARCHIVED PAGE]")]
        assert "舊的內文" in part
        assert "2018-09-25" in part, "the crawl date must be stated in the prompt"

    async def test_archived_text_never_becomes_a_source(self):
        """The safety property. resolved_meta is what becomes `sources`, so an
        archived page appearing there would present a page nobody could fetch as
        one the verifier read -- the failure this whole feature exists to stop."""
        ctx = make_context({COFACTS_HYPERLINKS_STATE_KEY: {URL: link()}})
        request = make_request(f"請查核 {URL}")

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(return_value=[unfetchable()]),
        ):
            await inject_resolved_url_content(ctx, request)

        assert any(t.startswith("[ARCHIVED PAGE]") for t in texts(request))
        assert ctx.state[RESOLVED_META_STATE_KEY] == {}

    async def test_timeout_also_falls_back(self):
        ctx = make_context({COFACTS_HYPERLINKS_STATE_KEY: {URL: link()}})
        request = make_request(f"請查核 {URL}")

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(
                return_value=[unfetchable(status=ResolveStatus.RESOLVER_UNAVAILABLE)]
            ),
        ):
            await inject_resolved_url_content(ctx, request)

        assert any(t.startswith("[ARCHIVED PAGE]") for t in texts(request))

    async def test_dead_url_gets_no_archived_copy(self):
        """A URL that does not resolve at all is broken now. Pairing the advisory
        note with the text it served years ago invites the citation the note is
        trying to prevent."""
        ctx = make_context({COFACTS_HYPERLINKS_STATE_KEY: {URL: link()}})
        request = make_request(f"請查核 {URL}")
        dead = ResolvedUrl(
            url=URL,
            canonical=None,
            title=None,
            summary=None,
            http_status=None,
            status=ResolveStatus.DEAD,
            error="domain name could not be resolved",
        )

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls", AsyncMock(return_value=[dead])
        ):
            await inject_resolved_url_content(ctx, request)

        assert not any(t.startswith("[ARCHIVED PAGE]") for t in texts(request))
        assert any(t.startswith("[LINK NOT FOUND]") for t in texts(request))

    async def test_no_archive_keeps_the_old_couldnt_fetch_note(self):
        ctx = make_context()
        request = make_request(f"請查核 {URL}")

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(return_value=[unfetchable()]),
        ):
            await inject_resolved_url_content(ctx, request)

        assert any(
            t.startswith("[NOTE] url-resolver couldn't fetch") for t in texts(request)
        )
        assert not any(t.startswith("[ARCHIVED PAGE]") for t in texts(request))

    async def test_a_live_fetch_is_never_replaced_by_the_archive(self):
        ctx = make_context({COFACTS_HYPERLINKS_STATE_KEY: {URL: link()}})
        request = make_request(f"請查核 {URL}")
        fresh = ResolvedUrl(
            url=URL,
            canonical=URL,
            title="新標題",
            summary="今天抓到的內文",
            http_status=200,
            status=ResolveStatus.RESOLVED,
            error=None,
        )

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls", AsyncMock(return_value=[fresh])
        ):
            await inject_resolved_url_content(ctx, request)

        assert any(t.startswith("[RESOLVED PAGE]") for t in texts(request))
        assert not any(t.startswith("[ARCHIVED PAGE]") for t in texts(request))
        assert ctx.state[RESOLVED_META_STATE_KEY][URL]["status"] == "resolved"
