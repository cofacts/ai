"""Unit tests for `inject_resolved_url_content`, the before-model callback
that pre-fetches plain web URLs through url-resolver for ai_verifier.

`resolve_urls` is monkeypatched so no network/gRPC is involved; a small fake
artifact store (dict-backed) stands in for `CallbackContext.load_artifact` /
`save_artifact` / `get_artifact_version`, since this callback uses the
artifact store both as its fetch cache and to persist the full page text for
the UI. Coverage: a resolved URL gets a `[RESOLVED PAGE]` part; a dead URL
(DNS failure) gets an advisory `[LINK NOT FOUND]` note, not a ban; a URL the
resolver merely couldn't fetch (e.g. a PDF) gets nothing injected so
url_context gets a clean shot at it; YouTube and Cofacts-media URLs are
excluded (handled elsewhere via FileData); re-running the callback on the
same request is a no-op (idempotency); a resolver outage injects nothing.
"""

from typing import cast
from unittest.mock import AsyncMock, patch

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.agent import inject_resolved_url_content
from cofacts_ai.url_resolver.client import ResolvedUrl, ResolveStatus


def make_request(*contents: genai_types.Content) -> LlmRequest:
    return LlmRequest(contents=list(contents))


def user_text(text: str) -> genai_types.Content:
    return genai_types.Content(role="user", parts=[genai_types.Part(text=text)])


def text_parts(content: genai_types.Content) -> list[str]:
    return [part.text for part in content.parts or [] if part.text]


class FakeArtifactStore:
    """Minimal in-memory stand-in for the ADK artifact service, keyed by
    filename -- enough to exercise load/save/get_artifact_version."""

    def __init__(self):
        self.blobs: dict[str, bytes] = {}
        self.metadata: dict[str, dict] = {}

    async def load_artifact(self, filename, version=None):
        if filename not in self.blobs:
            return None
        return genai_types.Part(
            inline_data=genai_types.Blob(
                mime_type="text/plain", data=self.blobs[filename]
            )
        )

    async def save_artifact(self, filename, artifact, custom_metadata=None):
        self.blobs[filename] = artifact.inline_data.data
        self.metadata[filename] = custom_metadata or {}
        return 1

    async def get_artifact_version(self, filename, version=None):
        if filename not in self.blobs:
            return None
        from types import SimpleNamespace

        return SimpleNamespace(custom_metadata=self.metadata.get(filename, {}))


def make_context(store: FakeArtifactStore | None = None) -> CallbackContext:
    store = store or FakeArtifactStore()
    ctx = AsyncMock()
    ctx.state = {}
    ctx.load_artifact = store.load_artifact
    ctx.save_artifact = store.save_artifact
    ctx.get_artifact_version = store.get_artifact_version
    return cast(CallbackContext, ctx)


def resolved(url: str, title: str = "Title", summary: str = "body text") -> ResolvedUrl:
    return ResolvedUrl(
        url=url,
        canonical=url,
        title=title,
        summary=summary,
        http_status=200,
        status=ResolveStatus.RESOLVED,
        error=None,
    )


def dead(url: str, error: str = "domain name could not be resolved") -> ResolvedUrl:
    return ResolvedUrl(
        url=url,
        canonical=None,
        title=None,
        summary=None,
        http_status=None,
        status=ResolveStatus.DEAD,
        error=error,
    )


def cant_fetch(url: str, error: str = "unsupported content type") -> ResolvedUrl:
    return ResolvedUrl(
        url=url,
        canonical=None,
        title=None,
        summary=None,
        http_status=None,
        status=ResolveStatus.RESOLVER_CANT_FETCH,
        error=error,
    )


def unavailable(url: str) -> ResolvedUrl:
    return ResolvedUrl(
        url=url,
        canonical=None,
        title=None,
        summary=None,
        http_status=None,
        status=ResolveStatus.RESOLVER_UNAVAILABLE,
        error="resolver down",
    )


class TestInjectResolvedUrlContent:
    async def test_resolved_url_injects_resolved_page_part(self):
        request = make_request(user_text("請查核 https://good.com/article"))
        context = make_context()

        with patch(
            "cofacts_ai.agent.resolve_urls",
            AsyncMock(return_value=[resolved("https://good.com/article")]),
        ):
            await inject_resolved_url_content(context, request)

        [part] = [
            t
            for t in text_parts(request.contents[0])
            if t.startswith("[RESOLVED PAGE]")
        ]
        assert "https://good.com/article" in part
        assert "body text" in part
        assert (
            context.state["temp:cofacts_resolved_meta"]["https://good.com/article"][
                "status"
            ]
            == "resolved"
        )

    async def test_dead_url_gets_advisory_note_not_a_ban(self):
        request = make_request(user_text("https://dead.example"))
        context = make_context()

        with patch(
            "cofacts_ai.agent.resolve_urls",
            AsyncMock(return_value=[dead("https://dead.example")]),
        ):
            await inject_resolved_url_content(context, request)

        [part] = [
            t
            for t in text_parts(request.contents[0])
            if t.startswith("[LINK NOT FOUND]")
        ]
        assert "https://dead.example" in part
        assert "url_context" in part
        assert "do NOT claim" in part

    async def test_resolver_cant_fetch_injects_nothing_by_default_to_url_context(self):
        request = make_request(user_text("https://report.example/file.pdf"))
        context = make_context()

        with patch(
            "cofacts_ai.agent.resolve_urls",
            AsyncMock(return_value=[cant_fetch("https://report.example/file.pdf")]),
        ):
            await inject_resolved_url_content(context, request)

        parts = text_parts(request.contents[0])
        assert not any(p.startswith("[RESOLVED PAGE]") for p in parts)
        assert not any(p.startswith("[LINK NOT FOUND]") for p in parts)
        # A one-line advisory note is fine, but nothing that bans the URL.
        for p in parts:
            assert "do NOT claim" not in p

    async def test_resolver_unavailable_injects_nothing(self):
        request = make_request(user_text("https://good.com"))
        context = make_context()
        original_parts = list(request.contents[0].parts or [])

        with patch(
            "cofacts_ai.agent.resolve_urls",
            AsyncMock(return_value=[unavailable("https://good.com")]),
        ):
            await inject_resolved_url_content(context, request)

        assert request.contents[0].parts == original_parts
        assert "temp:cofacts_resolved_meta" not in context.state

    async def test_youtube_url_excluded_from_resolution(self):
        request = make_request(user_text("https://youtu.be/abc123"))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[])

        with patch("cofacts_ai.agent.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)

        resolve_mock.assert_not_called()
        assert text_parts(request.contents[0]) == ["https://youtu.be/abc123"]

    async def test_cofacts_media_url_excluded_from_resolution(self):
        url = "https://storage.googleapis.com/cofacts-media-collection/production/video/x/original"
        request = make_request(user_text(url))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[])

        with patch("cofacts_ai.agent.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)

        resolve_mock.assert_not_called()

    async def test_rerunning_on_same_request_is_idempotent(self):
        request = make_request(user_text("https://good.com"))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[resolved("https://good.com")])

        with patch("cofacts_ai.agent.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)
            resolve_mock.assert_awaited_once()
            parts_after_first = list(request.contents[0].parts or [])

            await inject_resolved_url_content(context, request)

        # Second call found the URL already injected -- no new resolve, no
        # duplicate part appended.
        resolve_mock.assert_awaited_once()
        assert request.contents[0].parts == parts_after_first

    async def test_second_call_reuses_artifact_cache_not_network(self):
        request1 = make_request(user_text("https://good.com"))
        store = FakeArtifactStore()
        context1 = make_context(store)
        resolve_mock = AsyncMock(
            return_value=[resolved("https://good.com", title="Cached Title")]
        )

        with patch("cofacts_ai.agent.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context1, request1)

        # A brand new request/session-turn context sharing the same artifact
        # store (simulating a later turn in the same session) should hit the
        # cache instead of calling resolve_urls again.
        request2 = make_request(user_text("https://good.com"))
        context2 = make_context(store)
        with patch("cofacts_ai.agent.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context2, request2)

        resolve_mock.assert_awaited_once()
        [part] = [
            t
            for t in text_parts(request2.contents[0])
            if t.startswith("[RESOLVED PAGE]")
        ]
        assert "Cached Title" in part

    async def test_no_urls_in_request_is_a_noop(self):
        request = make_request(user_text("沒有連結的訊息"))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[])

        with patch("cofacts_ai.agent.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)

        resolve_mock.assert_not_called()
        assert "temp:cofacts_resolved_meta" not in context.state

    async def test_resolver_exception_is_swallowed(self):
        request = make_request(user_text("https://good.com"))
        context = make_context()
        original_parts = list(request.contents[0].parts or [])

        with patch(
            "cofacts_ai.agent.resolve_urls", AsyncMock(side_effect=RuntimeError("boom"))
        ):
            await inject_resolved_url_content(context, request)

        assert request.contents[0].parts == original_parts

    async def test_over_budget_batch_truncates_long_pages_keeps_short_whole(self):
        short_text = "s" * 100
        long_text = "l" * 1000
        request = make_request(user_text("https://short.com https://long.com"))
        context = make_context()

        with (
            patch(
                "cofacts_ai.agent.resolve_urls",
                AsyncMock(
                    return_value=[
                        resolved("https://short.com", summary=short_text),
                        resolved("https://long.com", summary=long_text),
                    ]
                ),
            ),
            patch.dict("os.environ", {"URL_RESOLVER_TOTAL_CHAR_BUDGET": "600"}),
        ):
            await inject_resolved_url_content(context, request)

        parts = {
            p.split("\n", 1)[0].removeprefix("[RESOLVED PAGE] "): p
            for p in text_parts(request.contents[0])
            if p.startswith("[RESOLVED PAGE]")
        }
        assert short_text in parts["https://short.com"]
        assert "truncated" not in parts["https://short.com"]
        assert "truncated from 1000 chars" in parts["https://long.com"]
        assert long_text not in parts["https://long.com"]
