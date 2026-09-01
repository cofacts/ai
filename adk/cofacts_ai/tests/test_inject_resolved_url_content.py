"""Unit tests for `inject_resolved_url_content`, the before-model callback
that pre-fetches plain web URLs through url-resolver for ai_verifier.

`resolve_urls` is monkeypatched so no network/gRPC is involved; a small fake
artifact store (dict-backed) stands in for `CallbackContext.load_artifact` /
`save_artifact`, since this callback uses the artifact store both as its fetch
cache and to persist the full page text for the UI. That fake's
`get_artifact_version` raises, matching the `ForwardingArtifactService` an
`AgentTool`-hosted agent actually gets -- see the class docstring.

Coverage: a resolved URL gets a `[RESOLVED PAGE]` part; a dead URL (DNS
failure) gets an advisory `[LINK NOT FOUND]` note, not a ban; a URL the
resolver merely couldn't fetch (e.g. a PDF) gets nothing injected so
url_context gets a clean shot at it; YouTube and Cofacts-media URLs are
excluded (handled elsewhere via FileData); re-running the callback on the
same request is a no-op (idempotency); a resolver outage injects nothing; and
the artifact cache round-trips page text plus title/canonical without the
version API, including for artifacts written before that envelope existed.
"""

from typing import cast
from unittest.mock import AsyncMock, patch

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.resolved_pages import (
    RESOLVED_META_STATE_KEY,
    _extract_web_urls,
    _resolved_artifact_filename,
    inject_resolved_url_content,
)
from cofacts_ai.url_resolver.client import ResolvedUrl, ResolveStatus


def make_request(*contents: genai_types.Content) -> LlmRequest:
    return LlmRequest(contents=list(contents))


def user_text(text: str) -> genai_types.Content:
    return genai_types.Content(role="user", parts=[genai_types.Part(text=text)])


def text_parts(content: genai_types.Content) -> list[str]:
    return [part.text for part in content.parts or [] if part.text]


class FakeArtifactStore:
    """Minimal in-memory stand-in for the ADK artifact service, keyed by
    filename.

    `get_artifact_version` raises, deliberately: production hands an
    `AgentTool`-hosted agent a `ForwardingArtifactService`, which only
    implements that method from ADK 2.5.0 and raises `NotImplementedError` on
    the pinned 1.26.0. An earlier version of this fake implemented it, which
    hid a bug where the first cache *hit* raised, the callback's blanket
    `except Exception` swallowed it, and the entire injection was abandoned --
    silently reverting the verifier to url_context-only. Keeping the raise here
    means every test in this file exercises the production plumbing.
    """

    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    async def load_artifact(self, filename, version=None):
        if filename not in self.blobs:
            return None
        return genai_types.Part(
            inline_data=genai_types.Blob(
                mime_type="text/plain", data=self.blobs[filename]
            )
        )

    async def save_artifact(self, filename, artifact, custom_metadata=None):
        # custom_metadata is accepted to mirror ADK's signature, but the
        # callback no longer passes it -- reading it back is what needed
        # get_artifact_version. Metadata now rides inside the artifact body.
        self.blobs[filename] = artifact.inline_data.data
        return 1

    async def get_artifact_version(self, filename, version=None):
        raise NotImplementedError(
            "ForwardingArtifactService.get_artifact_version is unimplemented "
            "on ADK 1.26.0"
        )


def make_context(
    store: FakeArtifactStore | None = None, state: dict | None = None
) -> CallbackContext:
    """`state` seeds the context the way agent_tool.py seeds a child session
    from the parent's state (`agent_tool.py:236-244`), which is why `temp:`
    keys survive from one ai_verifier call to the next. Leaving it always
    empty would make the fake kinder than production and hide the leak."""
    store = store or FakeArtifactStore()
    ctx = AsyncMock()
    ctx.state = dict(state or {})
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
            "cofacts_ai.resolved_pages.resolve_urls",
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
            "cofacts_ai.resolved_pages.resolve_urls",
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
            "cofacts_ai.resolved_pages.resolve_urls",
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
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(return_value=[unavailable("https://good.com")]),
        ):
            await inject_resolved_url_content(context, request)

        assert request.contents[0].parts == original_parts
        # Present and empty, not absent: leaving the key untouched is what let
        # a previous call's meta stand in for this one (see
        # TestResolvedMetaDoesNotLeakAcrossCalls).
        assert context.state[RESOLVED_META_STATE_KEY] == {}

    async def test_youtube_url_excluded_from_resolution(self):
        request = make_request(user_text("https://youtu.be/abc123"))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[])

        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)

        resolve_mock.assert_not_called()
        assert text_parts(request.contents[0]) == ["https://youtu.be/abc123"]

    async def test_cofacts_media_url_excluded_from_resolution(self):
        url = "https://storage.googleapis.com/cofacts-media-collection/production/video/x/original"
        request = make_request(user_text(url))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[])

        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)

        resolve_mock.assert_not_called()

    async def test_rerunning_on_same_request_is_idempotent(self):
        request = make_request(user_text("https://good.com"))
        context = make_context()
        resolve_mock = AsyncMock(return_value=[resolved("https://good.com")])

        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
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

        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context1, request1)

        # A brand new request/session-turn context sharing the same artifact
        # store (simulating a later turn in the same session) should hit the
        # cache instead of calling resolve_urls again.
        request2 = make_request(user_text("https://good.com"))
        context2 = make_context(store)
        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
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

        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context, request)

        resolve_mock.assert_not_called()
        # Same invariant as above: cleared, not skipped.
        assert context.state[RESOLVED_META_STATE_KEY] == {}

    async def test_resolver_exception_is_swallowed(self):
        request = make_request(user_text("https://good.com"))
        context = make_context()
        original_parts = list(request.contents[0].parts or [])

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(side_effect=RuntimeError("boom")),
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
                "cofacts_ai.resolved_pages.resolve_urls",
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

    async def test_cache_hit_survives_unimplemented_get_artifact_version(self):
        """Regression: the first cache *hit* must not abandon the injection.

        `ForwardingArtifactService.get_artifact_version` raises on the pinned
        ADK, and the callback's blanket `except Exception` turns any raise into
        a total, silent revert to url_context-only. Because the cache is filled
        on the 1st model call of a verifier turn, this fired on the 2nd call of
        that same turn and every verifier call after it in the session.
        """
        store = FakeArtifactStore()
        resolve_mock = AsyncMock(
            return_value=[resolved("https://good.com", title="Cached Title")]
        )
        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(
                make_context(store), make_request(user_text("https://good.com"))
            )

        # Second turn: served from cache, so get_artifact_version would be the
        # only reason to touch the version API.
        request2 = make_request(user_text("https://good.com"))
        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(make_context(store), request2)

        resolve_mock.assert_awaited_once()
        [part] = [
            t
            for t in text_parts(request2.contents[0])
            if t.startswith("[RESOLVED PAGE]")
        ]
        assert "body text" in part
        assert "Cached Title" in part

    async def test_legacy_raw_text_artifact_still_injects(self):
        """Artifacts written before the metadata envelope are raw page text.

        Preview deploys already wrote some. Treating an unparseable first line
        as page content -- rather than raising -- is what keeps those usable.
        """
        store = FakeArtifactStore()
        store.blobs[_resolved_artifact_filename("https://old.com")] = (
            b"legacy page body with no envelope"
        )
        request = make_request(user_text("https://old.com"))
        resolve_mock = AsyncMock(return_value=[])

        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(make_context(store), request)

        resolve_mock.assert_not_awaited()
        [part] = [
            t
            for t in text_parts(request.contents[0])
            if t.startswith("[RESOLVED PAGE]")
        ]
        assert "legacy page body with no envelope" in part
        # No stored title, so the URL stands in for it.
        assert "TITLE: https://old.com" in part

    async def test_untitled_page_does_not_round_trip_as_the_string_none(self):
        """`GcsArtifactService` stringifies custom_metadata, so an untitled page
        used to come back as the literal "None" -- truthy, so `or url` never
        fired and the UI showed "None" as the source title."""
        store = FakeArtifactStore()
        untitled = ResolvedUrl(
            url="https://untitled.com",
            canonical=None,
            title=None,
            summary="body text",
            http_status=200,
            status=ResolveStatus.RESOLVED,
            error=None,
        )
        with patch(
            "cofacts_ai.resolved_pages.resolve_urls", AsyncMock(return_value=[untitled])
        ):
            await inject_resolved_url_content(
                make_context(store), make_request(user_text("https://untitled.com"))
            )

        request2 = make_request(user_text("https://untitled.com"))
        context2 = make_context(store)
        with patch(
            "cofacts_ai.resolved_pages.resolve_urls", AsyncMock(return_value=[])
        ):
            await inject_resolved_url_content(context2, request2)

        [part] = [
            t
            for t in text_parts(request2.contents[0])
            if t.startswith("[RESOLVED PAGE]")
        ]
        assert "TITLE: None" not in part
        assert "TITLE: https://untitled.com" in part
        meta = context2.state["temp:cofacts_resolved_meta"]["https://untitled.com"]
        assert meta["title"] == "https://untitled.com"
        assert meta["canonical"] is None


class TestUrlExtraction:
    """URL boundaries, pinned against rumors-site.

    The site extracts URLs with `linkifyjs.tokenize()` (`lib/text.tsx`) and
    pins the hard cases in `lib/__tests__/text.tsx` under
    `parses half-width brackets correctly` / `parses full-width brackets
    correctly`. The first two tests below are those exact strings, so the two
    codebases agree on what counts as a URL. The rest cover CJK prose, which
    is the common case here and which the old regex got wrong.
    """

    def urls(self, text: str) -> list[str]:
        urls, _ = _extract_web_urls(make_request(user_text(text)))
        return urls

    def test_half_width_brackets_match_rumors_site(self):
        assert self.urls(
            "http://foo.com/blah_(a)_(b) (http://foo.com/blah_(a)_(b)) "
            "http://foo.com/blah_(a)_(b))"
        ) == ["http://foo.com/blah_(a)_(b)"]  # deduped; all three are the same URL

    def test_full_width_brackets_match_rumors_site(self):
        assert self.urls(
            "http://foo.com/blah_（a）_（b） （http://foo.com/blah_(a)_(b)） "
            "http://foo.com/blah_(a)_(b)）"
        ) == ["http://foo.com/blah_（a）_（b）", "http://foo.com/blah_(a)_(b)"]

    def test_cjk_punctuation_does_not_swallow_following_words(self):
        # Chinese has no spaces, so the old `[^\s...]+` ran the URL into the
        # next words and the resulting URL resolved DEAD.
        assert self.urls(
            "來源：https://example.com/a，另一個 https://example.com/b、"
            "還有 https://example.com/c！"
        ) == [
            "https://example.com/a",
            "https://example.com/b",
            "https://example.com/c",
        ]

    def test_full_width_period_is_not_part_of_the_url(self):
        assert self.urls("見 https://zh.wikipedia.org/wiki/水星_(行星)。") == [
            "https://zh.wikipedia.org/wiki/水星_(行星)"
        ]

    def test_wikipedia_disambiguation_parens_are_kept(self):
        assert self.urls(
            "請查核 https://en.wikipedia.org/wiki/Mercury_(planet) 這篇"
        ) == ["https://en.wikipedia.org/wiki/Mercury_(planet)"]
        # ...including when a sentence period follows.
        assert self.urls("見 https://en.wikipedia.org/wiki/Mercury_(planet).") == [
            "https://en.wikipedia.org/wiki/Mercury_(planet)"
        ]

    def test_query_string_survives_a_trailing_period(self):
        assert self.urls("https://example.com/s?q=a&b=1. 就這樣") == [
            "https://example.com/s?q=a&b=1"
        ]

    def test_youtube_and_cofacts_media_are_still_excluded(self):
        assert self.urls(
            "https://www.youtube.com/watch?v=abc123 和 https://example.com/x"
        ) == ["https://example.com/x"]


class TestResolvedMetaDoesNotLeakAcrossCalls:
    """`temp:cofacts_resolved_meta` must describe only the current call.

    ai_verifier runs as an AgentTool, once per claim, and `temp:` is not
    scoped per call -- agent_tool.py seeds the child session from the parent's
    state and forwards the child's delta back up. So a call that resolves
    nothing used to inherit the previous call's meta, and
    append_verifier_sources reported pages that response never read: a claim
    citing the *previous* claim's URLs.

    Each test seeds the second context with the first call's meta, which is
    what agent_tool.py actually does.
    """

    STALE = {
        "https://old.com": {"status": "resolved", "title": "Old", "canonical": None}
    }

    async def test_call_with_no_urls_does_not_inherit_previous_meta(self):
        context = make_context(state=dict(self.STALE))
        request = make_request(user_text("這則訊息沒有任何連結"))

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls", AsyncMock(return_value=[])
        ):
            await inject_resolved_url_content(context, request)

        assert context.state[RESOLVED_META_STATE_KEY] == {}

    async def test_all_timeouts_do_not_inherit_previous_meta(self):
        context = make_context(state=dict(self.STALE))
        request = make_request(user_text("https://slow.com"))

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(return_value=[unavailable("https://slow.com")]),
        ):
            await inject_resolved_url_content(context, request)

        assert context.state[RESOLVED_META_STATE_KEY] == {}

    async def test_exception_path_does_not_inherit_previous_meta(self):
        context = make_context(state=dict(self.STALE))
        request = make_request(user_text("https://boom.com"))

        with patch(
            "cofacts_ai.resolved_pages.resolve_urls",
            AsyncMock(side_effect=RuntimeError("resolver exploded")),
        ):
            await inject_resolved_url_content(context, request)

        assert context.state[RESOLVED_META_STATE_KEY] == {}

    async def test_clearing_meta_does_not_cost_a_refetch(self):
        """The regression guard for this change.

        The fetch cache is the artifact, not this state key, so clearing the
        key must not make the next call re-resolve. If this ever fails, the
        two mechanisms have been conflated.
        """
        store = FakeArtifactStore()
        resolve_mock = AsyncMock(
            return_value=[resolved("https://good.com", title="Cached Title")]
        )

        context1 = make_context(store)
        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(
                context1, make_request(user_text("https://good.com"))
            )

        # Second call, seeded from the first exactly as agent_tool.py would.
        context2 = make_context(
            store,
            state={RESOLVED_META_STATE_KEY: context1.state[RESOLVED_META_STATE_KEY]},
        )
        request2 = make_request(user_text("https://good.com"))
        with patch("cofacts_ai.resolved_pages.resolve_urls", resolve_mock):
            await inject_resolved_url_content(context2, request2)

        resolve_mock.assert_awaited_once()  # served from the artifact cache
        assert "https://good.com" in context2.state[RESOLVED_META_STATE_KEY]
        [part] = [
            t
            for t in text_parts(request2.contents[0])
            if t.startswith("[RESOLVED PAGE]")
        ]
        assert "Cached Title" in part
