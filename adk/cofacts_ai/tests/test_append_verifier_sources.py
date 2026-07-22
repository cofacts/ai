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
"""

from types import SimpleNamespace
from typing import cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_response import LlmResponse
from google.genai import types as genai_types

from cofacts_ai.agent import RESOLVED_META_STATE_KEY, append_verifier_sources


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
    async def test_resolved_meta_becomes_a_source(self):
        context = make_context(
            {
                "https://a.com": {
                    "status": "resolved",
                    "title": "A Title",
                    "canonical": "https://a.com/canonical",
                }
            }
        )
        response = make_response(grounding_chunks=[])

        result = await append_verifier_sources(context, response)

        assert result is not None
        assert sources_of(result) == [
            {"title": "A Title", "url": "https://a.com/canonical"}
        ]

    async def test_dead_url_never_becomes_a_source(self):
        context = make_context(
            {"https://dead.example": {"status": "dead", "error": "nope"}}
        )
        response = make_response(grounding_chunks=[])

        result = await append_verifier_sources(context, response)

        assert result is not None
        assert sources_of(result) == []

    async def test_resolver_cant_fetch_url_still_surfaces_via_url_context(self):
        # Not in resolved_meta at all (RESOLVER_CANT_FETCH isn't recorded there),
        # but url_context DID ground it -- it must still appear.
        context = make_context({})
        response = make_response(
            grounding_chunks=[web_chunk("https://pdf.example", "PDF Report")]
        )

        result = await append_verifier_sources(context, response)

        assert result is not None
        assert sources_of(result) == [
            {"title": "PDF Report", "url": "https://pdf.example"}
        ]

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
