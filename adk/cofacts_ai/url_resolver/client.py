"""Async gRPC client for the Cofacts url-resolver service.

url-resolver (https://github.com/cofacts/url-resolver) scrapes a URL with a
headless browser and returns the main body text extracted by Readability.js
(menu/footer/nav stripped), or an explicit error when the page could not be
fetched. This module wraps its `ResolveUrl` RPC with the semantics the
verifier callback needs: `html` (the full raw page, 100KB+) is dropped before
it ever leaves this module, resolver errors are bucketed into "the URL is
actually dead" vs. "the resolver merely couldn't fetch it" (see
`ResolveStatus`), and a resolver-wide outage never gets confused with either
— see the module-level docstring on `ResolveStatus` for why that distinction
matters.
"""

import logging
import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import grpc

from ._generated import resolve_error_pb2, url_resolver_pb2, url_resolver_pb2_grpc

logger = logging.getLogger(__name__)

DEFAULT_ADDRESS = "url-resolver:4000"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_URLS = 20


class ResolveStatus(str, Enum):
    """Outcome of resolving one URL.

    A url-resolver error is NOT proof a URL is fake — it may just be a
    resolver limitation (a PDF, a JS-heavy page, a page that blocks
    puppeteer) that Gemini's `url_context` tool can still read. So only
    `DEAD` (DNS failure / malformed URL) is a real "this link is bad"
    signal, and callers should still treat even that as advisory rather than
    an absolute ban (`url_context` may succeed where the resolver's simpler
    fetch failed). `RESOLVER_CANT_FETCH` / `TIMEOUT` / `RESOLVER_UNAVAILABLE`
    all mean "no signal from the resolver" — never flag those URLs as dead.
    """

    RESOLVED = "resolved"
    DEAD = "dead"
    RESOLVER_CANT_FETCH = "resolver_cant_fetch"
    TIMEOUT = "timeout"
    RESOLVER_UNAVAILABLE = "resolver_unavailable"


# ResolveError enum values that mean the URL itself is unusable (DNS doesn't
# resolve, or the URL is malformed) — the only errors treated as `DEAD`.
_DEAD_URL_ERRORS = frozenset(
    {
        resolve_error_pb2.NAME_NOT_RESOLVED,
        resolve_error_pb2.INVALID_URL,
    }
)

# Human-readable text for each ResolveError enum value, used in the `error`
# field so callers (and the text injected into the verifier's context) don't
# need to know the proto enum.
_ERROR_MESSAGES = {
    resolve_error_pb2.UNKNOWN_ERROR: "unknown error",
    resolve_error_pb2.NAME_NOT_RESOLVED: (
        "domain name could not be resolved (dead/nonexistent site)"
    ),
    resolve_error_pb2.INVALID_URL: "malformed URL",
    resolve_error_pb2.NOT_REACHABLE: "server not reachable",
    resolve_error_pb2.UNSUPPORTED: (
        "unsupported content type (not an HTML page, e.g. a PDF or download)"
    ),
    resolve_error_pb2.HTTPS_ERROR: "TLS/HTTPS error",
    resolve_error_pb2.UNKNOWN_SCRAP_ERROR: "page could not be scraped",
    resolve_error_pb2.UNKNOWN_UNFURL_ERROR: "page could not be unfurled",
}


@dataclass
class ResolvedUrl:
    """The outcome of resolving one URL. Never carries raw HTML."""

    url: str
    canonical: Optional[str]
    title: Optional[str]
    summary: Optional[str]
    http_status: Optional[int]
    status: ResolveStatus
    error: Optional[str]


def _bucket_error(error_enum: int) -> tuple[ResolveStatus, str]:
    status = (
        ResolveStatus.DEAD
        if error_enum in _DEAD_URL_ERRORS
        else (ResolveStatus.RESOLVER_CANT_FETCH)
    )
    message = _ERROR_MESSAGES.get(error_enum, "unknown error")
    return status, message


def _reply_to_resolved_url(reply: url_resolver_pb2.UrlReply) -> ResolvedUrl:
    which = reply.WhichOneof("result")
    if which == "successfully_resolved" and reply.successfully_resolved:
        return ResolvedUrl(
            url=reply.url,
            canonical=reply.canonical or None,
            title=reply.title or None,
            summary=reply.summary or None,
            http_status=reply.status or None,
            status=ResolveStatus.RESOLVED,
            error=None,
        )
    status, message = _bucket_error(reply.error if which == "error" else 0)
    return ResolvedUrl(
        url=reply.url,
        canonical=reply.canonical or None,
        title=reply.title or None,
        summary=reply.summary or None,
        http_status=reply.status or None,
        status=status,
        error=message,
    )


async def resolve_urls(
    urls: list[str],
    *,
    address: Optional[str] = None,
    max_urls: Optional[int] = None,
    timeout: Optional[float] = None,
) -> list[ResolvedUrl]:
    """Resolves each URL to its cleaned main body text via url-resolver.

    Dedups and caps `urls` to `max_urls` (preserving order), then streams
    `ResolveUrl` replies and joins them back to the request by `reply.url`
    (the server stream is not guaranteed to preserve request order). Any
    requested URL not answered by the time the stream ends is `TIMEOUT`. If
    the whole call fails before any reply arrives (resolver down/unreachable),
    every requested URL comes back `RESOLVER_UNAVAILABLE` — never treated as
    `DEAD`, since that would let a resolver outage falsely brand good URLs as
    dead links.

    `html` is never read off the reply — it must never reach an LLM.
    """
    address = address or os.environ.get("URL_RESOLVER_ADDRESS", DEFAULT_ADDRESS)
    max_urls = max_urls or int(
        os.environ.get("URL_RESOLVER_MAX_URLS", DEFAULT_MAX_URLS)
    )
    timeout = timeout or float(os.environ.get("URL_RESOLVER_TIMEOUT", DEFAULT_TIMEOUT))

    deduped_urls: list[str] = []
    seen = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            deduped_urls.append(url)
    deduped_urls = deduped_urls[:max_urls]
    if not deduped_urls:
        return []

    results: dict[str, ResolvedUrl] = {}
    channel = grpc.aio.insecure_channel(address)
    try:
        stub = url_resolver_pb2_grpc.UrlResolverStub(channel)
        call = stub.ResolveUrl(
            url_resolver_pb2.UrlsRequest(urls=deduped_urls), timeout=timeout
        )
        try:
            async for reply in call:
                resolved = _reply_to_resolved_url(reply)
                results[resolved.url] = resolved
        except grpc.aio.AioRpcError as e:
            if not results:
                # The whole call failed before any reply arrived (resolver
                # down/unreachable/timed out entirely) — treat every
                # requested URL as "no signal", never as dead.
                logger.warning(
                    "url-resolver call failed before any reply (%s); "
                    "treating %d URL(s) as resolver_unavailable",
                    e,
                    len(deduped_urls),
                )
                return [
                    ResolvedUrl(
                        url=url,
                        canonical=None,
                        title=None,
                        summary=None,
                        http_status=None,
                        status=ResolveStatus.RESOLVER_UNAVAILABLE,
                        error=str(e.details() or e),
                    )
                    for url in deduped_urls
                ]
            # Partial results already arrived; treat the rest as timed out
            # below (they're simply absent from `results`).
            logger.warning(
                "url-resolver stream ended early (%s); %d/%d URL(s) resolved",
                e,
                len(results),
                len(deduped_urls),
            )
    finally:
        await channel.close()

    return [
        results.get(
            url,
            ResolvedUrl(
                url=url,
                canonical=None,
                title=None,
                summary=None,
                http_status=None,
                status=ResolveStatus.TIMEOUT,
                error="no reply received before timeout",
            ),
        )
        for url in deduped_urls
    ]
