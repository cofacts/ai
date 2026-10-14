"""
Verifier page pre-fetch: real page text, injected before the model runs.

The verifier used to read linked pages only through Gemini's black-box
``url_context`` tool, with no deterministic proof a page was ever fetched —
the root cause of the source hallucination this module exists to stop. Here
every plain web URL in the request is resolved through ``url-resolver``
(see :mod:`cofacts_ai.url_resolver.client`) and the text it returns is
injected as ``[RESOLVED PAGE]`` parts the model cannot skip reading. That text
is the page's own description when its metadata is complete, and the
Readability-extracted body otherwise; the verifier prompt says so. ``url_context`` is kept alongside it, not replaced: it is still
the only source of page metadata, and it may reach a page the resolver's
simpler fetch missed.

Full page text is cached as an ADK artifact keyed by a hash of the URL, which
doubles as the fetch cache and as the UI-visible record of what was actually
read. What the callback resolved is handed to ``append_verifier_sources`` in
:mod:`cofacts_ai.agent` through ``RESOLVED_META_STATE_KEY``, since an
after-model callback cannot see the parts injected into the request.

Decision record: ``docs/decisions/20260722-url-resolver-verifier-prefetch.md``.
"""

import hashlib
import json
import logging
import os
from typing import Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from .archived_pages import ARCHIVED_LINKS_STATE_KEY, web_urls_in
from .url_resolver.client import (
    ResolvedUrl,
    ResolveStatus,
    UrlResolverConfigError,
    env_number,
    resolve_urls,
)

logger = logging.getLogger(__name__)

# Handoff from this module's before-model callback to append_verifier_sources'
# after-model callback: {url: {"status", "title", "canonical"}} for what
# url-resolver fetched for this model call. `temp:` scopes it to one verifier
# call: AgentTool's child session is seeded without `temp:` keys, and the deltas
# it forwards back up are trimmed of them. Within that call it does carry over
# from one model call to the next -- see the reset in
# inject_resolved_url_content.
RESOLVED_META_STATE_KEY = "temp:cofacts_resolved_meta"

# Every URL the same model call was asked to check, fetched or not, in the same
# handoff style: append_verifier_sources must not let one page's canonical stand
# in for another URL the verifier was asked about.
REQUESTED_URLS_STATE_KEY = "temp:cofacts_requested_urls"


_RESOLVED_PAGE_PREFIX = "[RESOLVED PAGE] "
_LINK_NOT_FOUND_PREFIX = "[LINK NOT FOUND] "

# Deliberately a different marker from [RESOLVED PAGE]. This text was not read
# in this turn and may describe a page that has since changed or gone, so the
# verifier must be able to tell the two apart -- and, in the prompt, is told to
# weigh them differently. It also never reaches `sources`: see the comment at
# the injection site.
_ARCHIVED_PAGE_PREFIX = "[ARCHIVED PAGE] "


def _stage_archived(
    url: str,
    cofacts_links: dict,
    archived: dict,
    lengths: dict,
) -> None:
    """Queue Cofacts' stored copy of `url` for injection, if it has one."""
    entry = cofacts_links.get(url)
    if not isinstance(entry, dict):
        return
    summary = entry.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return
    archived[url] = entry
    lengths[url] = len(summary)


_DEFAULT_TOTAL_CHAR_BUDGET = 200_000

# How many uncached URLs one verifier call may send to url-resolver. With cited
# blocks skipped, this is a safety bound rather than something a normal call
# reaches.
_DEFAULT_MAX_URLS = 20


def _resolved_artifact_filename(url: str) -> str:
    """Stable per-URL artifact filename, used as both the fetch cache key and
    the UI-visible record of the full page text that was read."""
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return f"resolved-{digest}.txt"


def _encode_resolved_artifact(
    text: str, title: Optional[str], canonical: Optional[str]
) -> bytes:
    """Pack page text plus its metadata into one artifact body.

    The metadata rides *inside* the artifact rather than in `custom_metadata`
    because reading that back requires `get_artifact_version`, which
    `ForwardingArtifactService` — the service an `AgentTool`-hosted agent gets,
    i.e. `ai_verifier` in production — only implements from ADK 2.5.0. On the
    pinned 1.26.0 it raises `NotImplementedError`, and a raise anywhere in
    `inject_resolved_url_content` costs the *entire* injection, silently
    reverting the verifier to url_context-only.

    Keeping it in the body also preserves a real `None`: `GcsArtifactService`
    stringifies `custom_metadata` values, so an untitled page came back as the
    literal string "None" — truthy, so the `or url` fallback never fired and
    the UI showed "None" as the source title.
    """
    header = json.dumps({"title": title, "canonical": canonical}, ensure_ascii=False)
    return f"{header}\n{text}".encode("utf-8")


def _decode_resolved_artifact(data: bytes) -> tuple[str, Optional[str], Optional[str]]:
    """Unpack `_encode_resolved_artifact`, tolerating pre-envelope artifacts.

    Artifacts written before the envelope existed are raw page text whose first
    line is page content, not JSON. Those must still be usable: falling through
    to an exception here would abandon the whole injection, which is the very
    failure this envelope exists to prevent. Such a body is returned as text
    with no metadata, and the caller's `or url` fallback supplies the title.
    """
    body = data.decode("utf-8")
    header, sep, text = body.partition("\n")
    if not sep:
        return body, None, None
    try:
        meta = json.loads(header)
    except (ValueError, TypeError):
        return body, None, None
    if not isinstance(meta, dict) or "title" not in meta:
        return body, None, None
    title = meta.get("title")
    canonical = meta.get("canonical")
    return (
        text,
        title if isinstance(title, str) else None,
        canonical if isinstance(canonical, str) else None,
    )


async def _load_cached_page(
    callback_context: CallbackContext, url: str
) -> Optional[tuple[str, Optional[str], Optional[str]]]:
    """(text, title, canonical) from the artifact cache, or None on a miss.

    A failed read is also a miss: the page is fetched again rather than the
    whole injection being abandoned over one storage error.
    """
    try:
        cached = await callback_context.load_artifact(_resolved_artifact_filename(url))
    except Exception:
        logger.exception("could not read the cached page for %s; refetching", url)
        return None
    if cached is None or not cached.inline_data or not cached.inline_data.data:
        return None
    return _decode_resolved_artifact(cached.inline_data.data)


async def _save_cached_page(
    callback_context: CallbackContext,
    url: str,
    text: str,
    title: Optional[str],
    canonical: Optional[str],
) -> None:
    """Cache a fetched page. A failed write is logged and dropped: the text is
    already in hand for this call, and only the next call's cache hit is lost."""
    try:
        await callback_context.save_artifact(
            filename=_resolved_artifact_filename(url),
            artifact=genai_types.Part(
                inline_data=genai_types.Blob(
                    mime_type="text/plain",
                    data=_encode_resolved_artifact(text, title, canonical),
                )
            ),
        )
    except Exception:
        logger.exception("could not cache the page for %s", url)


def _water_fill(lengths: dict[str, int], budget: int) -> dict[str, int]:
    """Max-min fair allocation of `budget` chars across `lengths`.

    Pages shorter than an equal share keep their full length; the budget
    freed by short pages is redistributed evenly across the pages too long
    to fit. If the total already fits under budget, every page gets its full
    length back (the loop below falls through with no truncation).
    """
    if not lengths:
        return {}
    items = sorted(lengths.items(), key=lambda kv: kv[1])
    remaining_budget = budget
    remaining_count = len(items)
    allocation: dict[str, int] = {}
    for i, (key, length) in enumerate(items):
        fair_share = remaining_budget / remaining_count if remaining_count else 0
        if length <= fair_share:
            allocation[key] = length
            remaining_budget -= length
            remaining_count -= 1
        else:
            # This item, and every remaining one (all >= it, since sorted
            # ascending), gets an equal split of what's left.
            equal_share = (
                int(remaining_budget // remaining_count) if remaining_count else 0
            )
            for key2, _ in items[i:]:
                allocation[key2] = equal_share
            break
    return allocation


def _extract_web_urls(
    llm_request: LlmRequest,
) -> tuple[list[str], Optional[genai_types.Content]]:
    """Plain http(s) URLs to pre-fetch via url-resolver, and the latest user
    content that mentioned any of them (mirrors inject_youtube_filedata's
    "latest content wins" — today each verifier AgentTool call is a fresh
    single-message session, so there is normally just one candidate).

    Skips every citation block `resolve_citations` hoisted into the request:
    cited results (a search dump, a research report, the suspicious message
    itself) are context for the verifier to read, not pages to fetch. A cited
    search dump alone can carry dozens of other articles' links, which would
    fill the URL cap, spend the shared text budget and be listed in `sources`
    as read. The writer asks for a page by writing its URL in the request.

    Excludes YouTube URLs (watched via FileData + url_context; url-resolver
    can only scrape HTML text, not video content) and Cofacts media URLs
    (same reason, handled by inject_cofacts_media_filedata).
    """
    urls: list[str] = []
    seen = set()
    target_content = None
    for content in llm_request.contents:
        if content.role != "user" or not content.parts:
            continue
        found_here = []
        for part in content.parts:
            if part.text:
                found_here.extend(web_urls_in(part.text))
        if not found_here:
            continue
        target_content = content
        for url in found_here:
            if url not in seen:
                seen.add(url)
                urls.append(url)
    return urls, target_content


async def inject_resolved_url_content(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Before-model callback for ai_verifier.

    Pre-fetches every plain web URL through url-resolver and injects the
    text it returned as [RESOLVED PAGE] parts (the page's description, or
    its Readability-extracted body -- see the module docstring), so the
    verifier bases support/refute decisions on text it actually read instead
    of relying solely on Gemini's black-box url_context tool — which is what
    let it hallucinate support for dead or irrelevant links. A URL
    url-resolver could not resolve at all (DNS failure / malformed) gets an
    advisory [LINK NOT FOUND] note rather than a hard ban, since url_context
    may still read a page the resolver's simpler fetch missed. Any other
    failure (PDF, blocked, timeout, resolver down, past the URL cap) gets
    Cofacts' earlier crawl as an [ARCHIVED PAGE] if one exists and nothing
    otherwise, so url_context gets a clean shot at it.

    Caches full page text as an ADK artifact keyed by a hash of the URL —
    this doubles as the fetch cache (skips re-resolving on the verifier's
    ~2 model calls per turn, and across turns in the same session) and as a
    UI-visible record of exactly what the system was able to read. Only
    successfully resolved text is cached; dead/unfetchable results are cheap
    to re-attempt and are not persisted.

    Every model call of a turn re-injects, by design. ADK rebuilds
    `llm_request.contents` from session events with `copy.deepcopy`
    (flows/llm_flows/contents.py), so parts appended here mutate the request
    only and are gone by the next call — the page text has to be re-sent or
    the call that writes the final answer would not have it. Deduping against
    the request cannot work for the same reason, and deduping against state
    would starve exactly that last call. The artifact cache keeps this from
    costing a re-fetch; it does cost re-sent tokens.
    """
    # Clear first, so every exit below -- the early returns, the `except`, and
    # the normal path -- leaves this key describing only the current model
    # call.
    #
    # The key cannot leak between verifier calls (see its definition), but it
    # does persist across the ~2 model calls of one: the child session is the
    # same. Without the reset, a later call that exits early -- the resolver
    # down, an artifact read failing -- would keep the earlier call's meta, and
    # append_verifier_sources would list pages missing from the request the
    # final answer was written from.
    #
    # This costs no extra fetches. The fetch cache is the artifact
    # (`resolved-<sha1>.txt`, loaded below); this key is only the handoff to
    # the after-model callback, which cannot see the injected request parts.
    callback_context.state[RESOLVED_META_STATE_KEY] = {}

    urls, target_content = _extract_web_urls(llm_request)
    callback_context.state[REQUESTED_URLS_STATE_KEY] = urls
    if not urls or target_content is None or target_content.parts is None:
        return None

    # Parsed up front, outside the guard below: a malformed
    # URL_RESOLVER_TOTAL_CHAR_BUDGET or URL_RESOLVER_MAX_URLS is a
    # misconfiguration and should crash loudly, not read as "this message had
    # no links".
    budget = int(
        os.environ.get("URL_RESOLVER_TOTAL_CHAR_BUDGET", _DEFAULT_TOTAL_CHAR_BUDGET)
    )
    max_urls = env_number("URL_RESOLVER_MAX_URLS", int)
    if max_urls is None:
        max_urls = _DEFAULT_MAX_URLS

    resolved_meta: dict[str, dict] = {}
    injected_parts: list[genai_types.Part] = []
    archived: dict[str, dict] = {}
    cofacts_links = callback_context.state.get(ARCHIVED_LINKS_STATE_KEY) or {}
    if not isinstance(cofacts_links, dict):
        cofacts_links = {}
    lengths: dict[str, int] = {}
    full_texts: dict[str, str] = {}
    titles: dict[str, str] = {}
    canonicals: dict[str, Optional[str]] = {}

    # Only the network call and the artifact I/O are guarded, and each on its
    # own. A resolver outage must degrade to url_context rather than fail the
    # turn, and a storage hiccup on one page must not cost the others: a
    # failed read is a cache miss, a failed write only loses the cache entry.
    # A bug in extraction, budgeting or part assembly is ours and must be
    # visible instead of masquerading as a message with no links -- and so is
    # a malformed URL_RESOLVER_* setting (UrlResolverConfigError).
    to_fetch: list[str] = []
    for url in urls:
        cached = await _load_cached_page(callback_context, url)
        if cached is None:
            to_fetch.append(url)
            continue
        text, title, canonical = cached
        full_texts[url] = text
        lengths[url] = len(text)
        titles[url] = title or url
        canonicals[url] = canonical

    # The cap bounds fetch work, so cache hits do not count toward it. Past
    # it, a URL gets what any unfetched one gets: Cofacts' archived copy if
    # there is one, and otherwise url_context alone.
    over_cap = to_fetch[max_urls:]
    to_fetch = to_fetch[:max_urls]
    if over_cap:
        logger.warning(
            "url-resolver: %d URL(s) past URL_RESOLVER_MAX_URLS=%d not fetched",
            len(over_cap),
            max_urls,
        )
        for url in over_cap:
            _stage_archived(url, cofacts_links, archived, lengths)

    if to_fetch:
        try:
            results = await resolve_urls(to_fetch)
        except UrlResolverConfigError:
            raise
        except Exception:
            # resolve_urls already turns gRPC failures into
            # RESOLVER_UNAVAILABLE; this is anything else it did not expect.
            # Same treatment, so cached pages and archived copies still go in.
            logger.exception(
                "url-resolver call failed; treating %d URL(s) as unavailable",
                len(to_fetch),
            )
            results = [
                ResolvedUrl(
                    url=url,
                    canonical=None,
                    title=None,
                    summary=None,
                    http_status=None,
                    status=ResolveStatus.RESOLVER_UNAVAILABLE,
                    error="url-resolver call failed",
                )
                for url in to_fetch
            ]
        for r in results:
            if r.status == ResolveStatus.RESOLVED and r.summary:
                full_texts[r.url] = r.summary
                lengths[r.url] = len(r.summary)
                titles[r.url] = r.title or r.url
                canonicals[r.url] = r.canonical
                await _save_cached_page(
                    callback_context, r.url, r.summary, r.title, r.canonical
                )
            elif r.status == ResolveStatus.DEAD:
                resolved_meta[r.url] = {
                    "status": ResolveStatus.DEAD.value,
                    "error": r.error,
                }
                injected_parts.append(
                    genai_types.Part(
                        text=(
                            f"{_LINK_NOT_FOUND_PREFIX}{r.url}: {r.error}. "
                            "url-resolver could not resolve this URL (likely "
                            "nonexistent/malformed). Verify with url_context; "
                            "if it also retrieves no content, do NOT claim "
                            "this link supports any claim."
                        )
                    )
                )
            else:
                # Everything else -- RESOLVER_CANT_FETCH (PDF, blocked, TLS),
                # TIMEOUT, RESOLVER_UNAVAILABLE -- is "no signal from
                # url-resolver", like a URL past the cap above. The reasons
                # differ but what the verifier should do does not: read the
                # page with url_context, which it is told to call for every
                # URL anyway. So all of them get the same treatment: Cofacts'
                # older crawl if there is one, and otherwise nothing. A
                # per-cause note would only restate "use url_context", and a
                # resolver hiccup surfaced as one risks being read as evidence
                # the link is bad.
                #
                # DEAD is deliberately excluded above: there the URL itself
                # does not resolve, and pairing "this link is broken" with the
                # text it served years ago invites exactly the citation the
                # advisory note is trying to prevent.
                _stage_archived(r.url, cofacts_links, archived, lengths)

    allocation = _water_fill(lengths, budget)
    for url, full_text in full_texts.items():
        allowed = allocation.get(url, len(full_text))
        truncated = allowed < len(full_text)
        body = full_text if not truncated else full_text[:allowed]
        text = f"{_RESOLVED_PAGE_PREFIX}{url}\nTITLE: {titles[url]}\n---\n{body}"
        if truncated:
            text += (
                f"\n---(truncated from {len(full_text)} chars; full text "
                f"in artifact {_resolved_artifact_filename(url)})"
            )
        injected_parts.append(genai_types.Part(text=text))
        resolved_meta[url] = {
            "status": ResolveStatus.RESOLVED.value,
            "title": titles[url],
            "canonical": canonicals[url],
        }

    # Archived copies share the same char budget -- they cost the same
    # context as a fresh page -- but are rendered under their own marker and
    # are POINTEDLY ABSENT from resolved_meta. That omission is the safety
    # property: resolved_meta is what append_verifier_sources turns into
    # `sources`, so a page nobody could fetch this turn can never be
    # presented to a reader as a source the verifier read.
    for url, entry in archived.items():
        full_text = entry["summary"]
        allowed = allocation.get(url, len(full_text))
        body = full_text if allowed >= len(full_text) else full_text[:allowed]
        fetched = entry.get("fetchedAt")
        when = (
            f"on {fetched[:10]}" if isinstance(fetched, str) else "at some earlier date"
        )
        injected_parts.append(
            genai_types.Part(
                text=(
                    f"{_ARCHIVED_PAGE_PREFIX}{url}\n"
                    f"TITLE: {entry.get('title') or url}\n"
                    f"url-resolver could not reach this page just now. The text "
                    f"below is what Cofacts crawled {when}, NOT what the page "
                    f"says today — it may have changed or gone. Use it as "
                    f"background only: do not treat it as confirmation that "
                    f"this link currently supports a claim, and prefer "
                    f"url_context if that can still read the page.\n---\n{body}"
                )
            )
        )

    if injected_parts:
        target_content.parts = list(target_content.parts) + injected_parts
    # Unconditional: an empty dict is the correct answer when this call
    # resolved nothing, and must not leave the pre-call value standing.
    callback_context.state[RESOLVED_META_STATE_KEY] = resolved_meta
    return None
