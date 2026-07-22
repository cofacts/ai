"""Unit tests for `cofacts_ai.url_resolver.client.resolve_urls`.

The client wraps url-resolver's server-streaming `ResolveUrl` RPC. These
tests fake the gRPC layer (channel + stub) so no real network or subprocess
is needed: `grpc.aio.insecure_channel` and `UrlResolverStub` are patched to
return controllable fakes that yield canned `UrlReply` messages or raise a
real `grpc.aio.AioRpcError` (constructed directly -- it can't be triggered
without a live server otherwise).

Coverage mirrors the invariants the verifier callback depends on: `html` is
never read off the reply, results are joined back to the request by URL (not
stream order), a URL missing from the stream becomes TIMEOUT, a whole-call
failure before any reply marks every URL RESOLVER_UNAVAILABLE (never DEAD --
a resolver outage must not falsely brand good links as dead), and each
`ResolveError` enum value buckets into DEAD (URL itself is bad) or
RESOLVER_CANT_FETCH (resolver limitation, url_context may still succeed).
"""

from unittest.mock import AsyncMock, patch

import grpc
import grpc.aio
import pytest

from cofacts_ai.url_resolver._generated import resolve_error_pb2, url_resolver_pb2
from cofacts_ai.url_resolver.client import ResolveStatus, resolve_urls


def make_reply(url: str, **kwargs) -> url_resolver_pb2.UrlReply:
    return url_resolver_pb2.UrlReply(url=url, **kwargs)


def rpc_error(code: grpc.StatusCode, details: str) -> grpc.aio.AioRpcError:
    metadata = grpc.aio.Metadata()
    return grpc.aio.AioRpcError(
        code=code,
        initial_metadata=metadata,
        trailing_metadata=metadata,
        details=details,
    )


class FakeUnaryStreamCall:
    """Fake of the object `stub.ResolveUrl(...)` returns: async-iterable,
    optionally raising an error after some number of replies."""

    def __init__(self, replies=(), error: Exception | None = None):
        self._replies = list(replies)
        self._error = error

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for reply in self._replies:
            yield reply
        if self._error is not None:
            raise self._error


class FakeStub:
    def __init__(self, call: FakeUnaryStreamCall):
        self._call = call

    def ResolveUrl(self, request, timeout=None):
        return self._call


class FakeChannel:
    close = AsyncMock()


def patched_client(call: FakeUnaryStreamCall):
    """Patches the two gRPC entry points resolve_urls touches, so no real
    channel/connection is ever created."""
    return (
        patch(
            "cofacts_ai.url_resolver.client.grpc.aio.insecure_channel",
            return_value=FakeChannel(),
        ),
        patch(
            "cofacts_ai.url_resolver.client.url_resolver_pb2_grpc.UrlResolverStub",
            return_value=FakeStub(call),
        ),
    )


class TestResolveUrlsHappyPath:
    async def test_resolved_reply_maps_fields_and_drops_html(self):
        reply = make_reply(
            "https://a.com",
            canonical="https://a.com/canonical",
            title="A Title",
            summary="cleaned body text",
            html="<html>huge raw page, must never surface</html>",
            status=200,
            successfully_resolved=True,
        )
        call = FakeUnaryStreamCall(replies=[reply])
        p1, p2 = patched_client(call)
        with p1, p2:
            [result] = await resolve_urls(["https://a.com"])

        assert result.status == ResolveStatus.RESOLVED
        assert result.canonical == "https://a.com/canonical"
        assert result.title == "A Title"
        assert result.summary == "cleaned body text"
        assert result.http_status == 200
        assert not hasattr(result, "html")

    async def test_join_by_url_not_stream_order(self):
        call = FakeUnaryStreamCall(
            replies=[
                make_reply("https://b.com", successfully_resolved=True, summary="b"),
                make_reply("https://a.com", successfully_resolved=True, summary="a"),
            ]
        )
        p1, p2 = patched_client(call)
        with p1, p2:
            results = await resolve_urls(["https://a.com", "https://b.com"])

        by_url = {r.url: r for r in results}
        assert by_url["https://a.com"].summary == "a"
        assert by_url["https://b.com"].summary == "b"

    async def test_missing_reply_becomes_timeout(self):
        call = FakeUnaryStreamCall(
            replies=[
                make_reply("https://a.com", successfully_resolved=True, summary="a")
            ]
        )
        p1, p2 = patched_client(call)
        with p1, p2:
            results = await resolve_urls(["https://a.com", "https://b.com"])

        by_url = {r.url: r for r in results}
        assert by_url["https://a.com"].status == ResolveStatus.RESOLVED
        assert by_url["https://b.com"].status == ResolveStatus.TIMEOUT

    async def test_dedups_and_caps_to_max_urls_preserving_order(self):
        call = FakeUnaryStreamCall(
            replies=[
                make_reply("https://a.com", successfully_resolved=True, summary="a"),
                make_reply("https://b.com", successfully_resolved=True, summary="b"),
            ]
        )
        p1, p2 = patched_client(call)
        with p1, p2:
            results = await resolve_urls(
                ["https://a.com", "https://a.com", "https://b.com", "https://c.com"],
                max_urls=2,
            )

        assert [r.url for r in results] == ["https://a.com", "https://b.com"]

    async def test_empty_input_returns_empty_without_opening_channel(self):
        call = FakeUnaryStreamCall(replies=[])
        p1, p2 = patched_client(call)
        with p1, p2 as stub_ctor:
            results = await resolve_urls([])

        assert results == []
        stub_ctor.assert_not_called()


class TestResolveUrlsErrorBucketing:
    @pytest.mark.parametrize(
        "enum_value",
        [resolve_error_pb2.NAME_NOT_RESOLVED, resolve_error_pb2.INVALID_URL],
    )
    async def test_dead_url_errors(self, enum_value):
        call = FakeUnaryStreamCall(
            replies=[make_reply("https://dead.example", error=enum_value)]
        )
        p1, p2 = patched_client(call)
        with p1, p2:
            [result] = await resolve_urls(["https://dead.example"])

        assert result.status == ResolveStatus.DEAD
        assert result.error is not None

    @pytest.mark.parametrize(
        "enum_value",
        [
            resolve_error_pb2.NOT_REACHABLE,
            resolve_error_pb2.UNSUPPORTED,
            resolve_error_pb2.HTTPS_ERROR,
            resolve_error_pb2.UNKNOWN_SCRAP_ERROR,
            resolve_error_pb2.UNKNOWN_UNFURL_ERROR,
            resolve_error_pb2.UNKNOWN_ERROR,
        ],
    )
    async def test_resolver_cant_fetch_errors(self, enum_value):
        call = FakeUnaryStreamCall(
            replies=[make_reply("https://blocked.example", error=enum_value)]
        )
        p1, p2 = patched_client(call)
        with p1, p2:
            [result] = await resolve_urls(["https://blocked.example"])

        assert result.status == ResolveStatus.RESOLVER_CANT_FETCH
        assert result.error is not None


class TestResolveUrlsTransportFailure:
    async def test_whole_call_failure_before_any_reply_marks_all_unavailable(self):
        error = rpc_error(grpc.StatusCode.UNAVAILABLE, "connection refused")
        call = FakeUnaryStreamCall(replies=[], error=error)
        p1, p2 = patched_client(call)
        with p1, p2:
            results = await resolve_urls(["https://a.com", "https://b.com"])

        assert all(r.status == ResolveStatus.RESOLVER_UNAVAILABLE for r in results)
        assert not any(r.status == ResolveStatus.DEAD for r in results)

    async def test_partial_stream_then_failure_keeps_received_and_times_out_rest(self):
        error = rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED, "deadline exceeded")
        call = FakeUnaryStreamCall(
            replies=[
                make_reply("https://a.com", successfully_resolved=True, summary="a")
            ],
            error=error,
        )
        p1, p2 = patched_client(call)
        with p1, p2:
            results = await resolve_urls(["https://a.com", "https://b.com"])

        by_url = {r.url: r for r in results}
        assert by_url["https://a.com"].status == ResolveStatus.RESOLVED
        assert by_url["https://b.com"].status == ResolveStatus.TIMEOUT
