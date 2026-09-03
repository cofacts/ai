"""
Verifier page pre-fetch: real page text, injected before the model runs.

The verifier used to read linked pages only through Gemini's black-box
``url_context`` tool, with no deterministic proof a page was ever fetched —
the root cause of the source hallucination this module exists to stop. Here
every plain web URL in the request is resolved through ``url-resolver``
(puppeteer + Readability, see :mod:`cofacts_ai.url_resolver.client`) and its
cleaned body text is injected as ``[RESOLVED PAGE]`` parts the model cannot
skip reading. ``url_context`` is kept alongside it, not replaced: it is still
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
import re
from typing import Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from .media_filedata import _COFACTS_MEDIA_URL_RE, _YOUTUBE_URL_RE
from .url_resolver.client import ResolveStatus, resolve_urls

logger = logging.getLogger(__name__)

# Handoff from this module's before-model callback to append_verifier_sources'
# after-model callback: {url: {"status", "title", "canonical"}} for what
# url-resolver fetched on this call. `temp:` keeps it out of the persisted
# session, but NOT out of the next AgentTool call — see the unconditional
# reset in inject_resolved_url_content.
RESOLVED_META_STATE_KEY = "temp:cofacts_resolved_meta"

# Cofacts' own url-resolver output for URLs seen in an article or reply,
# harvested from the writer's Cofacts tool responses and read here as a
# last-resort fallback: {url: {"summary", "title", "fetchedAt", "status"}}.
#
# Handed over as state rather than parsed back out of the request. The writer
# cites tool results to the verifier as plain text blocks (see
# writer_citations._render_block), and for `search_cofacts_database` that block
# is a whole JSON dump -- digging the hyperlinks back out of a prompt string
# would be a parser against a format that exists to be read by a model, not by
# us. `after_tool` already holds the structured response, and agent_tool.py
# seeds the verifier's child session from the writer's state, so the data can
# simply be carried.
#
# Unlike RESOLVED_META_STATE_KEY this deliberately ACCUMULATES across the turn
# and is never reset. That key is an assertion about one call ("these are the
# pages this response read"), so a stale value there is a fabricated citation.
# This one is a lookup table keyed by URL, where every entry is stamped with
# the date it was fetched -- an old entry is not wrong, just old, and the
# injected text says so.
COFACTS_HYPERLINKS_STATE_KEY = "temp:cofacts_hyperlinks"


# CJK sentence punctuation ends a URL. It has to be excluded from the match
# itself, not merely stripped afterwards: Chinese prose has no spaces, so
# `https://example.com/a，另一個` would otherwise capture the following words
# into the URL, which then resolves DEAD and gets the verifier told not to
# trust a perfectly good source.
#
# Full-width BRACKETS are deliberately absent from this set -- they can be part
# of a URL and are handled by _trim_url_punctuation below.
_CJK_URL_STOP = "，。、！？；：〜～…—「」『』〈〉《》【】"

_HTTP_URL_RE = re.compile(r"https?://[^\s\"'<>" + _CJK_URL_STOP + r"]+")

# Closing bracket -> its opener. A trailing closer is part of the URL when the
# URL contains a matching opener (`.../Mercury_(planet)`) and prose punctuation
# when it does not (`(https://example.com)`).
_URL_CLOSING_BRACKETS = {")": "(", "]": "[", "}": "{", "）": "（"}

# Punctuation that commonly ends a sentence right after a URL. Brackets are
# handled by the balance rule above instead of appearing here.
_URL_TRAILING_CHARS = ".,;:!?\"'"


def _trim_url_punctuation(url: str) -> str:
    """Strip prose punctuation from the end of an extracted URL.

    Mirrors what rumors-site gets from `linkifyjs.tokenize()` (`lib/text.tsx`),
    whose behaviour is pinned by its own `parses half-width brackets correctly`
    / `parses full-width brackets correctly` tests. A plain `rstrip` of a
    punctuation set cannot do this: it would break `.../Mercury_(planet)` by
    taking the closing paren that belongs to the URL, and it cannot tell that
    apart from the wrapping paren in `(https://example.com)`.

    `linkify-it-py` was tried instead of hand-rolling this and rejected -- it
    handles half-width brackets but keeps a trailing full-width `）` and, more
    importantly, swallows following words in CJK prose exactly as the old
    regex did.
    """
    while url:
        last = url[-1]
        opener = _URL_CLOSING_BRACKETS.get(last)
        if opener is not None:
            if url.count(opener) >= url.count(last):
                break  # balanced -- the bracket belongs to the URL
            url = url[:-1]
        elif last in _URL_TRAILING_CHARS:
            url = url[:-1]
        else:
            break
    return url


def harvest_cofacts_hyperlinks(
    callback_context: CallbackContext, tool_response: object
) -> None:
    """Collect `hyperlinks` out of a Cofacts tool response into state.

    Called from ai_writer's after_tool callback, where the response is still a
    dict. Walks it rather than indexing fixed paths, because the two tools nest
    the same field differently -- `get_single_cofacts_article` under
    `article.hyperlinks` plus one list per reply, `search_cofacts_database`
    under `data.edges[].node.hyperlinks` -- and a walk keeps working if the
    GraphQL shape moves.

    Only entries with usable text are kept. `status`/`error` record how Cofacts'
    own crawl went, and a hyperlink whose crawl failed carries no summary worth
    falling back to.
    """
    found: dict[str, dict] = {}

    def walk(node: object) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        links = node.get("hyperlinks")
        if isinstance(links, list):
            for link in links:
                if not isinstance(link, dict):
                    continue
                url = link.get("url")
                summary = link.get("summary")
                if not isinstance(url, str) or not isinstance(summary, str):
                    continue
                if not summary.strip() or link.get("status") != 200:
                    continue
                found[url] = {
                    "summary": summary,
                    "title": link.get("title"),
                    "fetchedAt": link.get("fetchedAt"),
                }
        for value in node.values():
            walk(value)

    walk(tool_response)
    if not found:
        return
    existing = callback_context.state.get(COFACTS_HYPERLINKS_STATE_KEY) or {}
    # Merge rather than replace: one turn can touch several articles, and the
    # verifier may be called about a URL first seen two tool calls ago.
    callback_context.state[COFACTS_HYPERLINKS_STATE_KEY] = {**existing, **found}


_RESOLVED_PAGE_PREFIX = "[RESOLVED PAGE] "
_LINK_NOT_FOUND_PREFIX = "[LINK NOT FOUND] "
_RESOLVER_CANT_FETCH_PREFIX = "[NOTE] url-resolver couldn't fetch "

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
) -> bool:
    """Queue Cofacts' stored copy of `url` for injection. True if there was one.

    The caller uses the return value to decide whether it still needs to emit
    its own "couldn't fetch" note -- an archived copy says that and more.
    """
    entry = cofacts_links.get(url)
    if not isinstance(entry, dict):
        return False
    summary = entry.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        return False
    archived[url] = entry
    lengths[url] = len(summary)
    return True


_DEFAULT_TOTAL_CHAR_BUDGET = 200_000


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
            if not part.text:
                continue
            for match in _HTTP_URL_RE.findall(part.text):
                url = _trim_url_punctuation(match)
                if _YOUTUBE_URL_RE.fullmatch(url) or _COFACTS_MEDIA_URL_RE.fullmatch(
                    url
                ):
                    continue
                found_here.append(url)
        if not found_here:
            continue
        target_content = content
        for url in found_here:
            if url not in seen:
                seen.add(url)
                urls.append(url)
    return urls, target_content


def _url_already_injected(llm_request: LlmRequest, url: str) -> bool:
    """True if a [RESOLVED PAGE]/[LINK NOT FOUND]/[NOTE] part for this URL is
    already present anywhere in the request. The verifier's before_model
    callbacks re-run on every model call in a turn (the request is rebuilt
    from conversation history each time), so without this check we'd
    re-inject the same page text on every call — mirrors the `seen` dedup in
    inject_cofacts_media_filedata."""
    markers = (
        f"{_RESOLVED_PAGE_PREFIX}{url}\n",
        f"{_ARCHIVED_PAGE_PREFIX}{url}\n",
        f"{_LINK_NOT_FOUND_PREFIX}{url}:",
        f"{_RESOLVER_CANT_FETCH_PREFIX}{url} (",
    )
    for content in llm_request.contents:
        for part in content.parts or []:
            if part.text and part.text.startswith(markers):
                return True
    return False


async def inject_resolved_url_content(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Before-model callback for ai_verifier.

    Pre-fetches every plain web URL through url-resolver and injects the
    real Readability-cleaned body text as [RESOLVED PAGE] parts, so the
    verifier bases support/refute decisions on text it actually read instead
    of relying solely on Gemini's black-box url_context tool — which is what
    let it hallucinate support for dead or irrelevant links. A URL
    url-resolver could not resolve at all (DNS failure / malformed) gets an
    advisory [LINK NOT FOUND] note rather than a hard ban, since url_context
    may still read a page the resolver's simpler fetch missed; a URL the
    resolver merely couldn't fetch (PDF, blocked, ...) gets nothing injected
    so url_context gets a clean shot at it.

    Caches full page text as an ADK artifact keyed by a hash of the URL —
    this doubles as the fetch cache (skips re-resolving on the verifier's
    ~2 model calls per turn, and across turns in the same session) and as a
    UI-visible record of exactly what the system was able to read. Only
    successfully resolved text is cached; dead/unfetchable results are cheap
    to re-attempt and are not persisted.
    """
    # Clear first, so every exit below -- the early returns, the `except`, and
    # the normal path -- leaves this key describing only the current call.
    #
    # `temp:` is NOT scoped per AgentTool call: agent_tool.py seeds the child
    # session from the parent's state and forwards the child's delta back up,
    # so without this a call that resolves nothing inherits the previous
    # call's meta and append_verifier_sources reports pages this response
    # never read. ai_verifier runs once per claim, so that is a claim citing
    # the *previous* claim's URLs -- the fabricated citation this whole
    # feature exists to prevent.
    #
    # This costs no extra fetches. The fetch cache is the artifact
    # (`resolved-<sha1>.txt`, loaded below); this key is only the handoff to
    # the after-model callback, which cannot see the injected request parts.
    callback_context.state[RESOLVED_META_STATE_KEY] = {}

    try:
        urls, target_content = _extract_web_urls(llm_request)
        urls = [url for url in urls if not _url_already_injected(llm_request, url)]
        if not urls or target_content is None or target_content.parts is None:
            return None

        resolved_meta: dict[str, dict] = {}
        injected_parts: list[genai_types.Part] = []
        archived: dict[str, dict] = {}
        cofacts_links = callback_context.state.get(COFACTS_HYPERLINKS_STATE_KEY) or {}
        if not isinstance(cofacts_links, dict):
            cofacts_links = {}
        lengths: dict[str, int] = {}
        full_texts: dict[str, str] = {}
        titles: dict[str, str] = {}
        canonicals: dict[str, Optional[str]] = {}

        to_fetch: list[str] = []
        for url in urls:
            filename = _resolved_artifact_filename(url)
            cached = await callback_context.load_artifact(filename)
            if cached is not None and cached.inline_data and cached.inline_data.data:
                text, title, canonical = _decode_resolved_artifact(
                    cached.inline_data.data
                )
                full_texts[url] = text
                lengths[url] = len(text)
                titles[url] = title or url
                canonicals[url] = canonical
            else:
                to_fetch.append(url)

        if to_fetch:
            results = await resolve_urls(to_fetch)
            for r in results:
                if r.status == ResolveStatus.RESOLVED and r.summary:
                    full_texts[r.url] = r.summary
                    lengths[r.url] = len(r.summary)
                    titles[r.url] = r.title or r.url
                    canonicals[r.url] = r.canonical
                    await callback_context.save_artifact(
                        filename=_resolved_artifact_filename(r.url),
                        artifact=genai_types.Part(
                            inline_data=genai_types.Blob(
                                mime_type="text/plain",
                                data=_encode_resolved_artifact(
                                    r.summary, r.title, r.canonical
                                ),
                            )
                        ),
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
                # Everything below is "the resolver failed, the page probably
                # didn't": RESOLVER_CANT_FETCH (PDF, blocked, TLS) and the two
                # no-signal buckets. These are the cases where Cofacts' own
                # older crawl of the same URL is worth having, so try it before
                # falling through to url_context alone.
                #
                # DEAD is deliberately excluded: there the URL itself does not
                # resolve, and pairing "this link is broken" with the text it
                # served years ago invites exactly the citation the advisory
                # note is trying to prevent.
                elif r.status == ResolveStatus.RESOLVER_CANT_FETCH:
                    if not _stage_archived(r.url, cofacts_links, archived, lengths):
                        injected_parts.append(
                            genai_types.Part(
                                text=(
                                    f"{_RESOLVER_CANT_FETCH_PREFIX}{r.url} "
                                    f"({r.error}) — may be a PDF or blocked; "
                                    "rely on url_context."
                                )
                            )
                        )
                else:
                    # TIMEOUT / RESOLVER_UNAVAILABLE. Without an archived copy
                    # this stays silent on purpose: a resolver hiccup must never
                    # be mistaken for proof that a URL is dead.
                    _stage_archived(r.url, cofacts_links, archived, lengths)

        budget = int(
            os.environ.get("URL_RESOLVER_TOTAL_CHAR_BUDGET", _DEFAULT_TOTAL_CHAR_BUDGET)
        )
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
                f"on {fetched[:10]}"
                if isinstance(fetched, str)
                else "at some earlier date"
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

        if not injected_parts:
            return None
        target_content.parts = list(target_content.parts) + injected_parts
        # Unconditional: an empty dict is the correct answer when this call
        # resolved nothing, and must not leave the pre-call value standing.
        callback_context.state[RESOLVED_META_STATE_KEY] = resolved_meta
    except Exception:
        logger.exception(
            "inject_resolved_url_content failed; skipping url-resolver injection"
        )
    return None
