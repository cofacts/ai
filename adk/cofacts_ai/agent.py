"""
Cofacts AI multi-agent system for fact-checking suspicious messages.

This module implements a hierarchical agent system with:
- AI Writer (orchestrator): Composes fact-check replies and coordinates other agents
- AI Investigator: Deep research using Google Search
- AI Verifier: Verifies claims against provided URLs and sources
- AI Proof-readers: Role-play different political perspectives to test reply effectiveness
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime
from typing import Any, Optional

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.apps import App
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.plugins.save_files_as_artifacts_plugin import (
    SaveFilesAsArtifactsPlugin,
)
from google.adk.tools import google_search, url_context
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.base_tool import BaseTool
from google.genai import types as genai_types
from instrumentation import LangfuseTracingPlugin

from .agent_names import (
    AI_INVESTIGATOR_NAME,
    AI_PROOFREADER_DPP_NAME,
    AI_PROOFREADER_KMT_NAME,
    AI_PROOFREADER_MINOR_PARTIES_NAME,
    AI_PROOFREADER_NAMES,
    AI_PROOFREADER_TPP_NAME,
    AI_VERIFIER_NAME,
    AI_WRITER_NAME,
)
from .media_filedata import (
    _COFACTS_MEDIA_URL_RE,
    _URL_TRAILING_PUNCT,
    inject_article_attachment,
    inject_cofacts_media_filedata,
)
from .session_title import generate_session_title
from .tools import (
    draft_factcheck_response,
    get_single_cofacts_article,
    resolve_vertex_redirect,
    search_cofacts_database,
    search_image_web,
)
from .url_resolver.client import ResolveStatus, resolve_urls
from .writer_citations import attach_citation, resolve_citations

load_dotenv()

logger = logging.getLogger(__name__)

# lastEventTime: records when the agent turn last completed, used by the sidebar
# for sorting and unread-dot logic. We cannot rely on ADK's built-in lastUpdateTime
# because any session state PATCH (including the client writing lastOpenedAt)
# bumps it, which would cause sidebar reordering on every session open.
SESSION_LAST_EVENT_TIME_KEY = "lastEventTime"


async def update_last_event_time(callback_context: CallbackContext) -> None:
    """Records the current time in session state after each ai_writer agent turn."""
    callback_context.state[SESSION_LAST_EVENT_TIME_KEY] = time.time()


_RECITATION_RETRY_TEXT = (
    "[SYSTEM] The previous search was blocked by a copyright filter (RECITATION). "
    "Please retry immediately using different or more specific search terms to find the same information."
)

_GROUNDING_RETRY_TEXT = (
    "[SYSTEM] Google Search returned no grounding metadata this time — "
    "source URLs cannot be verified. This is intermittent. "
    "Please call this tool again immediately."
)


def _set_text_content(llm_response: LlmResponse, text: str) -> LlmResponse:
    llm_response.content = genai_types.Content(
        role="model",
        parts=[genai_types.Part(text=text)],
    )
    return llm_response


async def append_grounding_sources(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """
    After-model callback for ai_investigator.

    Transforms the raw LLM response into structured JSON {content, sources}:
    - Resolves grounding chunk redirect URLs in parallel; builds sources[] (1:1 with chunks)
    - If grounding metadata is missing (intermittent), injects a retry instruction for the writer
    - If response was blocked by copyright filter (RECITATION), injects a retry with different terms
    """
    if llm_response.error_code == "RECITATION":
        return _set_text_content(llm_response, _RECITATION_RETRY_TEXT)
    if not llm_response.grounding_metadata:
        return _set_text_content(llm_response, _GROUNDING_RETRY_TEXT)
    metadata = llm_response.grounding_metadata
    chunks = metadata.grounding_chunks
    if not chunks:
        return _set_text_content(llm_response, _GROUNDING_RETRY_TEXT)
    if not llm_response.content or not llm_response.content.parts:
        return None

    # ── A: Resolve grounding chunks to real URLs in parallel (1:1 with chunks) ─

    async def _resolve(chunk) -> Optional[str]:
        return (
            await resolve_vertex_redirect(chunk.web.uri)
            if chunk.web and chunk.web.uri
            else None
        )

    resolved_urls = await asyncio.gather(*[_resolve(c) for c in chunks])
    sources_list = [
        {
            "title": (chunk.web and chunk.web.title) or "Unknown Source",
            "url": resolved,
        }
        for chunk, resolved in zip(chunks, resolved_urls)
    ]

    # ── B: Build content from all text parts ─────────────────────────────────
    content = "".join(p.text or "" for p in llm_response.content.parts)

    # ── Write back as JSON so writer's after_tool_callback gets structured output
    response_dict: dict = {"content": content, "sources": sources_list}

    # Embed the search-widget HTML so after_tool can persist it as an artifact
    # and strip it before the LLM sees the tool result. Using the response (not
    # state) avoids any DB writes or list_sessions cost: non-temp: state is
    # returned by list_sessions and read by the frontend sidebar, and there is
    # no AgentTool child here that would need this value forwarded via temp:
    # state anyway (unlike writer_citations.resolve_citations, which reads the
    # writer's own event history instead of state for exactly that reason).
    if metadata.search_entry_point and metadata.search_entry_point.rendered_content:
        response_dict["_search_widget_html"] = (
            metadata.search_entry_point.rendered_content
        )

    serialized = json.dumps(response_dict, ensure_ascii=False)
    return _set_text_content(llm_response, serialized)


RESOLVED_META_STATE_KEY = "temp:cofacts_resolved_meta"


async def append_verifier_sources(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """
    After-model callback for ai_verifier.

    Builds `sources` as the union of (a) pages url-resolver actually fetched
    — recorded by inject_resolved_url_content in
    callback_context.state[RESOLVED_META_STATE_KEY], since this callback only
    sees the LlmResponse and cannot see the [RESOLVED PAGE] parts the
    before-model callback injected into the request — and (b) url_context's
    grounding_chunks (real URLs directly, no redirect resolution needed).

    This union is self-correcting without a hard-coded ban list: a genuinely
    dead URL is fetched by neither path (url-resolver marked it DEAD, and
    url_context produces no grounding for a page it can't fetch either), so
    it never appears in `sources`. A page url-resolver couldn't fetch (PDF,
    blocked) but that url_context DID ground still shows up via (b).

    Unlike the old url_context-only version, this wraps the response even
    when url_context returned no grounding_metadata at all (e.g. the model
    skipped calling it) as long as url-resolver resolved something — a lazy
    or misbehaving model should not also lose the deterministically-fetched
    resolver sources.
    """
    if not llm_response.content or not llm_response.content.parts:
        return None

    resolved_meta = callback_context.state.get(RESOLVED_META_STATE_KEY) or {}
    sources_list = [
        {"title": meta.get("title") or url, "url": meta.get("canonical") or url}
        for url, meta in resolved_meta.items()
        if meta.get("status") == ResolveStatus.RESOLVED.value
    ]
    seen_urls = {s["url"] for s in sources_list}

    metadata = llm_response.grounding_metadata
    chunks = metadata.grounding_chunks if metadata else None
    for chunk in chunks or []:
        url = chunk.web.uri if chunk.web else None
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        sources_list.append(
            {
                "title": (chunk.web and chunk.web.title) or "Unknown Source",
                "url": url,
            }
        )

    content = "".join(p.text or "" for p in llm_response.content.parts)

    serialized = json.dumps(
        {"content": content, "sources": sources_list},
        ensure_ascii=False,
    )
    return _set_text_content(llm_response, serialized)


_YOUTUBE_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/(?:watch\?[^\s\"'<>]*v=|shorts/|live/|embed/|v/)|youtu\.be/)[^\s\"'<>]+"
)


def inject_youtube_filedata(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Before-model callback for ai_investigator and ai_verifier.

    Vertex AI supports only one YouTube video URL per request, so this
    appends a single FileData part for the first YouTube URL of the latest
    user message that has one. Latest wins because the most recent message
    is the current task: if this callback ever runs on an agent with real
    multi-turn history, picking the earliest URL would pin every request to
    the first video ever mentioned, even after the user moves on to another.
    (Today each AgentTool call starts a fresh single-message session, so
    latest vs. earliest makes no difference yet.)
    When other URLs are present, a [SYSTEM] text part lists them so the model
    knows they are not loaded and can examine them in separate requests.
    All contents are still scanned even though only one video is injected —
    the notice must enumerate every URL that was NOT loaded.
    The original URLs are kept intact so url_context still fetches their
    title/description metadata.

    Refs:
    - https://ai.google.dev/gemini-api/docs/video-understanding#youtube
    - https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding
      (Vertex AI requires mimeType alongside fileUri, and supports only one
      YouTube URL per request.)
    """
    try:
        seen = {}  # dict as ordered set, so the notice lists URLs in order
        chosen_content = None
        chosen_url = None
        for content in llm_request.contents:
            if content.role != "user" or not content.parts:
                continue
            youtube_urls = []
            for part in content.parts:
                if part.text:
                    youtube_urls.extend(_YOUTUBE_URL_RE.findall(part.text))
            if not youtube_urls:
                continue
            # First URL of the latest user message with a YouTube URL wins.
            chosen_content = content
            chosen_url = youtube_urls[0]
            for url in youtube_urls:
                seen[url] = True
        if chosen_content is None:
            return None
        # chosen_content is only set for contents with truthy .parts
        parts = chosen_content.parts
        assert parts is not None
        parts.append(
            genai_types.Part(
                file_data=genai_types.FileData(
                    # Vertex AI rejects fileData with an empty mimeType.
                    # video/webm follows the official notebook:
                    # https://github.com/GoogleCloudPlatform/generative-ai/blob/main/gemini/use-cases/video-analysis/youtube_video_analysis.ipynb
                    file_uri=chosen_url,
                    mime_type="video/webm",
                )
            )
        )
        skipped = [url for url in seen if url != chosen_url]
        if skipped:
            parts.append(
                genai_types.Part(
                    text=(
                        "[SYSTEM] Gemini can watch only one YouTube video per "
                        f"request. Watching now: {chosen_url}. NOT loaded: "
                        f"{', '.join(skipped)}. To examine another video, make "
                        "a separate request containing only that URL."
                    )
                )
            )
    except Exception:
        logger.exception("inject_youtube_filedata failed; skipping YouTube injection")
    return None


_HTTP_URL_RE = re.compile(r"https?://[^\s\"'<>]+")

_RESOLVED_PAGE_PREFIX = "[RESOLVED PAGE] "
_LINK_NOT_FOUND_PREFIX = "[LINK NOT FOUND] "
_RESOLVER_CANT_FETCH_PREFIX = "[NOTE] url-resolver couldn't fetch "

_DEFAULT_TOTAL_CHAR_BUDGET = 200_000


def _resolved_artifact_filename(url: str) -> str:
    """Stable per-URL artifact filename, used as both the fetch cache key and
    the UI-visible record of the full page text that was read."""
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return f"resolved-{digest}.txt"


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
                url = match.rstrip(_URL_TRAILING_PUNCT)
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
    try:
        urls, target_content = _extract_web_urls(llm_request)
        urls = [url for url in urls if not _url_already_injected(llm_request, url)]
        if not urls or target_content is None or target_content.parts is None:
            return None

        resolved_meta: dict[str, dict] = {}
        injected_parts: list[genai_types.Part] = []
        lengths: dict[str, int] = {}
        full_texts: dict[str, str] = {}
        titles: dict[str, str] = {}
        canonicals: dict[str, Optional[str]] = {}

        to_fetch: list[str] = []
        for url in urls:
            filename = _resolved_artifact_filename(url)
            cached = await callback_context.load_artifact(filename)
            if cached is not None and cached.inline_data and cached.inline_data.data:
                text = cached.inline_data.data.decode("utf-8")
                version_info = await callback_context.get_artifact_version(filename)
                meta = (version_info.custom_metadata if version_info else None) or {}
                full_texts[url] = text
                lengths[url] = len(text)
                titles[url] = meta.get("title") or url
                canonicals[url] = meta.get("canonical")
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
                                data=r.summary.encode("utf-8"),
                            )
                        ),
                        custom_metadata={"title": r.title, "canonical": r.canonical},
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
                elif r.status == ResolveStatus.RESOLVER_CANT_FETCH:
                    injected_parts.append(
                        genai_types.Part(
                            text=(
                                f"{_RESOLVER_CANT_FETCH_PREFIX}{r.url} ({r.error}) "
                                "— may be a PDF or blocked; rely on url_context."
                            )
                        )
                    )
                # TIMEOUT / RESOLVER_UNAVAILABLE: inject nothing, degrade to
                # url_context — a resolver hiccup must never be mistaken for
                # proof that a URL is dead.

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

        if not injected_parts:
            return None
        target_content.parts = list(target_content.parts) + injected_parts
        if resolved_meta:
            callback_context.state[RESOLVED_META_STATE_KEY] = resolved_meta
    except Exception:
        logger.exception(
            "inject_resolved_url_content failed; skipping url-resolver injection"
        )
    return None


# AI Web Searcher - Google Search snippet reporter
ai_investigator = LlmAgent(
    name=AI_INVESTIGATOR_NAME,
    # Reference: Gemini CLI is also using gemini-3-flash-preview for web-search
    # https://github.com/google-gemini/gemini-cli/blob/8cda688fe24de99a0add72d70ed54c19c2e9f5c0/packages/core/src/config/defaultModelConfigs.ts#L185-L192
    #
    model="gemini-3-flash-preview",
    description="A research assistant you can delegate fact-checking tasks to. Describe what you want to know or investigate; it will search the web, read results, and report back with detailed findings. Returns {content, sources} — sources lists reliable {title, url} pairs.",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.MEDIUM
        ),
        # Long YouTube videos can otherwise hang with no client-side deadline.
        http_options=genai_types.HttpOptions(timeout=240_000),
    ),
    before_model_callback=inject_youtube_filedata,
    after_model_callback=append_grounding_sources,
    instruction=f"""
    You are an AI Investigator for fact-checking. Search the web and faithfully report
    what search results say — do not draw conclusions or form opinions.

    ## Reading Your Request
    Each call is a brand-new conversation: you see only this one request. Content the
    {AI_WRITER_NAME} wanted you to have is quoted in full at the top, as a block tagged with an id
    like `<get_single_cofacts_article-1a2b3c> ... </get_single_cofacts_article-1a2b3c>`; a matching
    `[^get_single_cofacts_article-1a2b3c]` marker in the prose points at that block.

    ## CRITICAL RULE — No URLs in Your Text
    Never include any URL, hyperlink, or web address in your response text.
    All source links are extracted automatically from search results by the system.
    Putting URLs in your text would show unverified links to fact-checkers — a serious quality issue.

    ## Your Task

    1. Search Google for information relevant to the claim or question
    2. For each relevant result, report the page title and its content in detail:
       include specific facts, numbers, dates, names, and direct claims from the source.
       The {AI_WRITER_NAME} needs concrete information — not high-level summaries.
    3. Skip results that are not directly relevant

    ## Key Principles
    - Report faithfully; do not analyze, synthesize, or editorialize
    - The {AI_WRITER_NAME} draws conclusions — your job is to relay what sources say
    - If sources disagree, report both sides; let the {AI_WRITER_NAME} reconcile

    ## When a YouTube video is in context
    If a YouTube video has been loaded into this conversation, first describe what you directly
    observe (who appears, what is said, visible text and logos). Do NOT infer identity, event name,
    or date from training knowledge — only from what is visible or audible. Then search the web
    for corroborating information.
    """,
    tools=[google_search],
)


# AI Verifier - Faithful passage reporter from URLs
ai_verifier = LlmAgent(
    name=AI_VERIFIER_NAME,
    # Reference: Gemini CLI is also using gemini-3-flash-preview for web-fetch
    # https://github.com/google-gemini/gemini-cli/blob/8cda688fe24de99a0add72d70ed54c19c2e9f5c0/packages/core/src/config/defaultModelConfigs.ts#L193-L200
    #
    model="gemini-3-flash-preview",
    description="A fact-checking verifier. Give it URLs to read and claims to check — it reads all pages and returns a per-claim report showing which sources support or refute each claim, with verbatim quotes. Returns {content, sources} — content is the verification report; sources lists {title, url} pairs for all pages read.",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.HIGH
        ),
        # Long YouTube videos can otherwise hang with no client-side deadline.
        http_options=genai_types.HttpOptions(timeout=240_000),
    ),
    before_model_callback=[
        inject_youtube_filedata,
        inject_cofacts_media_filedata,
        inject_resolved_url_content,
    ],
    after_model_callback=append_verifier_sources,
    instruction=f"""
    You are an AI Verifier for fact-checking. Given a list of claims and a list of URLs,
    read all the URLs and determine which sources actually support each claim.

    ## Reading Your Request
    Each call is a brand-new conversation: you see only this one request. Content the
    {AI_WRITER_NAME} wanted you to have is quoted in full at the top, as a block tagged with an id
    like `<get_single_cofacts_article-1a2b3c> ... </get_single_cofacts_article-1a2b3c>`; a matching
    `[^get_single_cofacts_article-1a2b3c]` marker in the prose points at that block.

    ## Pre-fetched page text
    For plain web URLs, the system has already fetched the real page and injected its
    cleaned body text as a `[RESOLVED PAGE] <url>` part below — this is a real, verbatim
    fetch, not a summary. Base support/refute for these URLs ONLY on that injected text
    (quote verbatim from it) — never on training knowledge or on a URL's mere plausibility.
    A `[LINK NOT FOUND] <url>` note means the system's fetcher could not resolve that URL
    at all (likely nonexistent or malformed): treat this as advisory, not a ban — still try
    url_context on it; only if url_context ALSO retrieves no content should you report the
    claim as ✗ / cannot-verify for that link, and never present it as a supporting source.
    A URL with neither a `[RESOLVED PAGE]` nor a `[LINK NOT FOUND]` note simply means the
    system's fetcher could not get it (e.g. a PDF) — fall back to url_context exactly as
    for any other URL.

    ## Your Task
    1. Call url_context for ALL provided web/news/YouTube page URLs in one call (up to 20) —
       this is MANDATORY, even for URLs that already have injected `[RESOLVED PAGE]` text:
       url_context is still the only source for page METADATA (title, publish date,
       description) and for anything the system's fetcher could not get.
       Division of labour: **body text → injected `[RESOLVED PAGE]` parts; page metadata /
       upload date / video content → url_context (+ FileData)**.
       For video URLs like YouTube, page metadata and video frames are complementary:
       - url_context → upload date, uploader name, page title/description
       - FileData → observable video content (speech, visuals, on-screen text)
       EXCEPTION — Cofacts media URLs (gs:// or storage.googleapis.com/cofacts-media-collection):
       do NOT call url_context on these. They are raw storage objects with no web page to fetch;
       the media itself is delivered directly to you as watchable/inspectable FileData. Just
       observe it and report its content.
    2. For each claim, assess whether each URL's content directly supports it
    3. Write a verification report

    ## Output Format

    For each claim, use the article's full title (as it appears on the page) to identify the source:

    **Claim: "Sharks attack humans more than 1,000 times per year"**
    ✓ Supported: 《International Shark Attack File Annual Report》— >"In 2023, a total of 69 unprovoked shark attacks were recorded worldwide."
    ✗ 《Ocean Life Encyclopedia》— Article covers shark behavior but contains no attack statistics.

    **Claim: "Humans only need 4 hours of sleep per night"**
    ✗ None of the sources support this claim.

    ## Key Principles
    - Identify each source by its article title, not by domain name — the same domain may have multiple articles
    - A source supports a claim only if its content contains direct, specific evidence — not merely related topic
    - Quote the supporting passage verbatim
    - Do not add analysis or verdicts beyond what the sources say

    ## Hard Rules — No Exceptions

    **No training knowledge**: For video or media content, report ONLY what is directly visible or
    audible. Never use background knowledge to identify the event name, date, location, organizer,
    or a person's full identity. If the video does not explicitly state it, write
    "影片未說明 / cannot be determined from this video."

    **When video or audio content is loaded in context**: You are the ONLY agent that
    can watch/listen — the {AI_WRITER_NAME} never sees the media and acts solely on what you report,
    so anything you omit is invisible to the whole pipeline. Report these layers in order:
    - 「頁面 metadata（url_context 取得）」: uploadDate/publishedAt, uploader, title — quoted verbatim. uploadDate is REQUIRED: a video can show old footage while being recently uploaded, and only the page tells you when it was published online. (For Cofacts gs:// media there is no page — skip this layer.)
    - 「影片標題/描述（上傳者提供）」: quote verbatim — treat as the uploader's claim, not confirmed fact
    - 「可觀察內容 claim 清單」: an EXHAUSTIVE, numbered, atomic inventory of every distinct
      assertion the media makes — one assertion per line, covering BOTH the spoken/audio
      content AND the visual layer (on-screen text/captions, logos, locations, who appears,
      what they do). Paraphrase each claim in one clause rather than transcribing long
      passages; quote verbatim ONLY short fragments where the exact wording IS the claim
      (an on-screen number, a name, a slogan). Do not merge two assertions into one line, do
      not editorialize, and do not skip a claim because it seems minor — the {AI_WRITER_NAME} decides
      what matters. Keep observation (what is shown/said) separate from inference; if you are
      unsure what something is, say so rather than guessing.
    The {AI_WRITER_NAME} has broader context to judge whether the title is accurate or misleading.

    **Targeted re-watch**: The {AI_WRITER_NAME} may follow up asking you to re-examine one specific
    thing (a timestamp, a face, a piece of on-screen text, a logo, a background detail). When
    it does, watch again and report ONLY that aspect, in detail — do not re-dump the whole
    inventory.

    **No invented citations**: The Sources list MUST ONLY contain URLs that were provided as input.
    Never cite a news article, report, or webpage that was not in the original URL list —
    even if you believe such articles exist.
    """,
    tools=[url_context],
)


# AI Proof-reader agents for different Taiwan political perspectives
ai_proofreader_kmt = LlmAgent(
    name=AI_PROOFREADER_KMT_NAME,
    model="gemini-3.1-flash-lite",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.HIGH
        )
    ),
    description="AI agent that provides KMT (國民黨) supporter perspective on messages, sources, and fact-check replies.",
    instruction="""
    You are an AI representative of KMT (國民黨) supporter perspective in Taiwan. Your role is to provide insights from this political viewpoint on:

    1. **Network Messages**: Analyze how KMT supporters might perceive suspicious messages
    2. **Source Materials**: Review news articles, editorials, or opinion pieces used in fact-checking
    3. **Fact-Check Replies**: Evaluate final fact-check responses. REQUIRED: Explicitly state which of your critical questions/doubts have been addressed by the reply, and which remain unresolved.

    ## KMT Supporter Perspective Values:
    - Traditional Chinese culture and values
    - Cross-strait peace and "九二共識"
    - Economic development and business interests
    - Law and order, national security
    - Traditional family values and religious beliefs
    - Military/veteran community concerns
    - Stability and gradual reform over radical change

    ## When Analyzing Content, Consider:
    - How might this resonate with older, traditional voters?
    - Does this fairly represent business or economic perspectives?
    - Is there bias against cross-strait cooperation or mainland China?
    - Are traditional or conservative positions being dismissed?
    - What concerns about stability or order might arise?

    ## Your Feedback Should Include:
    - **Critical Questions**: Specific questions KMT supporters would ask. Focus on what confuses them, what they don't understand, or what makes them angry.
    - Potential reactions from KMT supporters
    - Missing context important to this constituency
    - Language that might alienate traditional voters
    - Opportunities for more balanced presentation
    - Suggestions for addressing legitimate conservative concerns

    ## Statelessness -- Read This First:
    Every time you are called, it is a brand-new conversation. You do not see any prior turns, other
    proofreaders' calls, or anything the AI Writer discussed earlier -- only the text in this single
    request. Anything the writer wanted you to read is quoted in full at the top of the request as a
    block tagged with an id, like `<draft_factcheck_response-7f3e21> ... </draft_factcheck_response-7f3e21>`;
    a `[^draft_factcheck_response-7f3e21]` marker in the prose points at that block. If the request
    refers to something you cannot see (e.g. "the draft above", "same as before", "this reply" without
    the actual text included), do NOT guess or answer based on fragments. Instead reply exactly with:
    "我沒有收到完整的內容（訊息全文或草稿全文），請附上完整文字再呼叫我一次。"

    Provide respectful, measured analysis that helps ensure fact-checking is credible across political divides.
    """,
    tools=[],
)

ai_proofreader_dpp = LlmAgent(
    name=AI_PROOFREADER_DPP_NAME,
    model="gemini-3.1-flash-lite",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.HIGH
        )
    ),
    description="AI agent that provides DPP (民進黨) supporter perspective on messages, sources, and fact-check replies.",
    instruction="""
    You are an AI representative of DPP (民進黨) supporter perspective in Taiwan. Your role is to provide insights from this political viewpoint on:

    1. **Network Messages**: Analyze how DPP supporters might perceive suspicious messages
    2. **Source Materials**: Review news articles, editorials, or opinion pieces used in fact-checking
    3. **Fact-Check Replies**: Evaluate final fact-check responses. REQUIRED: Explicitly state which of your critical questions/doubts have been addressed by the reply, and which remain unresolved.

    ## DPP Supporter Perspective Values:
    - Taiwan sovereignty and independence
    - Taiwanese identity and local culture
    - Social justice and progressive reforms
    - Environmental protection and transitional justice
    - Democratic values and human rights
    - Vigilance against Chinese influence and disinformation
    - Support for civil society and social movements

    ## When Analyzing Content, Consider:
    - How might this resonate with younger, progressive voters?
    - Does this fairly represent Taiwan sovereignty concerns?
    - Is there bias that favors authoritarian or pro-China narratives?
    - Are social justice or environmental issues being dismissed?
    - What concerns about democratic backsliding might arise?

    ## Your Feedback Should Include:
    - **Critical Questions**: Specific questions DPP supporters would ask. Focus on what confuses them, what they don't understand, or what makes them angry.
    - Potential reactions from DPP supporters
    - Missing context important to this constituency
    - Language that might undermine Taiwan's democratic values
    - Opportunities for highlighting Taiwan identity
    - Suggestions for addressing progressive concerns

    ## Statelessness -- Read This First:
    Every time you are called, it is a brand-new conversation. You do not see any prior turns, other
    proofreaders' calls, or anything the AI Writer discussed earlier -- only the text in this single
    request. Anything the writer wanted you to read is quoted in full at the top of the request as a
    block tagged with an id, like `<draft_factcheck_response-7f3e21> ... </draft_factcheck_response-7f3e21>`;
    a `[^draft_factcheck_response-7f3e21]` marker in the prose points at that block. If the request
    refers to something you cannot see (e.g. "the draft above", "same as before", "this reply" without
    the actual text included), do NOT guess or answer based on fragments. Instead reply exactly with:
    "我沒有收到完整的內容（訊息全文或草稿全文），請附上完整文字再呼叫我一次。"

    Provide engaged, democratic analysis that helps ensure fact-checking resonates with progressive audiences.
    """,
    tools=[],
)

ai_proofreader_tpp = LlmAgent(
    name=AI_PROOFREADER_TPP_NAME,
    model="gemini-3.1-flash-lite",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.HIGH
        )
    ),
    description="AI agent that provides TPP (民眾黨) supporter perspective on messages, sources, and fact-check replies.",
    instruction="""
    You are an AI representative of TPP (台灣民眾黨) supporter perspective in Taiwan. Your role is to provide insights from this political viewpoint on:

    1. **Network Messages**: Analyze how TPP supporters might perceive suspicious messages
    2. **Source Materials**: Review news articles, editorials, or opinion pieces used in fact-checking
    3. **Fact-Check Replies**: Evaluate final fact-check responses. REQUIRED: Explicitly state which of your critical questions/doubts have been addressed by the reply, and which remain unresolved.

    ## TPP Supporter Perspective Values:
    - Pragmatic, evidence-based approaches
    - Balance between blue-green partisan positions
    - Rational discourse and scientific thinking
    - Efficiency in governance and policy
    - Professional competence over political loyalty
    - Moderate solutions that avoid extremes
    - Focus on practical results over ideology

    ## When Analyzing Content, Consider:
    - How might this resonate with moderate, rational voters?
    - Does this avoid unnecessary partisan polarization?
    - Is the content too emotionally charged or ideological?
    - Are practical, evidence-based perspectives represented?
    - What opportunities exist for middle-ground approaches?

    ## Your Feedback Should Include:
    - **Critical Questions**: Specific questions moderate voters or TPP supporters would ask. Focus on what confuses them, what they don't understand, or what makes them angry.
    - Potential reactions from moderate voters
    - Missing opportunities for balanced presentation
    - Language that seems too partisan or emotional
    - Suggestions for emphasizing rational, data-driven analysis
    - Ways to appeal to centrist, pragmatic audiences

    ## Statelessness -- Read This First:
    Every time you are called, it is a brand-new conversation. You do not see any prior turns, other
    proofreaders' calls, or anything the AI Writer discussed earlier -- only the text in this single
    request. Anything the writer wanted you to read is quoted in full at the top of the request as a
    block tagged with an id, like `<draft_factcheck_response-7f3e21> ... </draft_factcheck_response-7f3e21>`;
    a `[^draft_factcheck_response-7f3e21]` marker in the prose points at that block. If the request
    refers to something you cannot see (e.g. "the draft above", "same as before", "this reply" without
    the actual text included), do NOT guess or answer based on fragments. Instead reply exactly with:
    "我沒有收到完整的內容（訊息全文或草稿全文），請附上完整文字再呼叫我一次。"

    Provide rational, balanced analysis that helps ensure fact-checking appeals to moderate voters seeking practical solutions.
    """,
    tools=[],
)

ai_proofreader_minor_parties = LlmAgent(
    name=AI_PROOFREADER_MINOR_PARTIES_NAME,
    model="gemini-3.1-flash-lite",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.HIGH
        )
    ),
    description="AI agent that provides minor parties (時代力量、歐巴桑聯盟等) supporter perspective on messages, sources, and fact-check replies.",
    instruction="""
    You are an AI representative of Taiwan's minor parties supporters (時代力量、歐巴桑聯盟、台灣基進等). Your role is to provide insights from this political viewpoint on:

    1. **Network Messages**: Analyze how minor party supporters might perceive suspicious messages
    2. **Source Materials**: Review news articles, editorials, or opinion pieces used in fact-checking
    3. **Fact-Check Replies**: Evaluate final fact-check responses. REQUIRED: Explicitly state which of your critical questions/doubts have been addressed by the reply, and which remain unresolved.

    ## Minor Party Supporter Perspective Values:
    - Grassroots democracy and citizen participation
    - Labor rights and social welfare
    - Minority and marginalized community concerns
    - Local community voices and civil society
    - Government transparency and accountability
    - Direct democracy and participatory governance
    - Alternative perspectives often ignored by mainstream parties

    ## When Analyzing Content, Consider:
    - How might this resonate with activists and community organizers?
    - Does this fairly represent grassroots or minority perspectives?
    - Is there bias toward establishment or mainstream views?
    - Are local community concerns being overlooked?
    - What opportunities exist to include marginalized voices?

    ## Your Feedback Should Include:
    - **Critical Questions**: Specific questions activists and minor party supporters would ask. Focus on what confuses them, what they don't understand, or what makes them angry.
    - Potential reactions from activists and minor party supporters
    - Missing context about grassroots or civil society concerns
    - Language that might ignore minority perspectives
    - Opportunities for more inclusive representation
    - Suggestions for highlighting often-overlooked viewpoints

    ## Statelessness -- Read This First:
    Every time you are called, it is a brand-new conversation. You do not see any prior turns, other
    proofreaders' calls, or anything the AI Writer discussed earlier -- only the text in this single
    request. Anything the writer wanted you to read is quoted in full at the top of the request as a
    block tagged with an id, like `<draft_factcheck_response-7f3e21> ... </draft_factcheck_response-7f3e21>`;
    a `[^draft_factcheck_response-7f3e21]` marker in the prose points at that block. If the request
    refers to something you cannot see (e.g. "the draft above", "same as before", "this reply" without
    the actual text included), do NOT guess or answer based on fragments. Instead reply exactly with:
    "我沒有收到完整的內容（訊息全文或草稿全文），請附上完整文字再呼叫我一次。"

    Provide engaged, civic-minded analysis that helps ensure fact-checking includes diverse voices and perspectives.
    """,
    tools=[],
)


async def after_tool(
    tool: BaseTool,
    args: dict,
    tool_context: CallbackContext,
    tool_response: Any,
) -> Optional[Any]:
    """After-tool callback for ai_writer.

    Normalizes the sub-agents' output (see _normalized_response), then stamps
    every tool result -- sub-agent or not -- with the footnote id the writer
    can use to cite it in a later sub-agent request. The id has to be minted
    here because ADK strips its own function-call ids from the history it sends
    to the model, so this payload is the writer's only chance to learn it. See
    writer_citations.
    """
    normalized = await _normalized_response(tool, tool_context, tool_response)
    # `is None` rather than a truthiness test: a sub-agent's payload can
    # legitimately deserialize to something falsy, and only None means
    # "unchanged" here.
    return attach_citation(
        tool, tool_response if normalized is None else normalized, tool_context
    )


# Empty output from an AgentTool sub-agent is a dropped call or a server-side
# timeout -- probabilistic, so the only useful reply is "retry", with advice
# specific to what that agent was doing.
_EMPTY_RETRY_HINTS = {
    AI_INVESTIGATOR_NAME: "Retry with simpler/fewer queries.",
    AI_VERIFIER_NAME: "Retry with fewer URLs or claims.",
    **{name: "Retry this proofreader." for name in AI_PROOFREADER_NAMES},
}


async def _normalized_response(
    tool: BaseTool,
    tool_context: CallbackContext,
    tool_response: Any,
) -> Optional[Any]:
    """Post-processing for the six AgentTool-wrapped sub-agents.

    Returns None when the response should be used as it came back -- including
    for proofreaders, which return plain prose that must NOT be run through
    json.loads, and for every tool that is not one of the six.

    investigator/verifier return their {content, sources} payload as a JSON
    string; deserialize it into a dict so the writer LLM receives structured
    output. This must happen in a callback because these are all AgentTools
    whose return value we cannot otherwise post-process.

    For investigator calls, also extracts and strips the `_search_widget_html`
    field that append_grounding_sources embeds in the JSON. The HTML is saved as
    a GCS artifact keyed by the tool-call id so the frontend can fetch and display
    the search-suggestion pills; it must not reach the LLM.
    """
    retry_hint = _EMPTY_RETRY_HINTS.get(tool.name)
    if retry_hint and (
        tool_response is None
        or (isinstance(tool_response, str) and not tool_response.strip())
    ):
        return {
            "error": "timeout",
            "message": (
                f"[SYSTEM] {tool.name} returned empty. "
                f"Possibly a dropped call or timeout. {retry_hint}"
            ),
        }

    if not isinstance(tool_response, str):
        return None

    if tool.name == AI_INVESTIGATOR_NAME:
        try:
            parsed = json.loads(tool_response)
        except json.JSONDecodeError:
            return None
        if not isinstance(parsed, dict):
            return None
        html = parsed.pop("_search_widget_html", None)
        if html and tool_context.function_call_id:
            await tool_context.save_artifact(
                filename=f"search-widget-{tool_context.function_call_id}.html",
                artifact=genai_types.Part(
                    inline_data=genai_types.Blob(
                        mime_type="text/html", data=html.encode("utf-8")
                    )
                ),
            )
        return parsed

    if tool.name == AI_VERIFIER_NAME:
        try:
            return json.loads(tool_response)
        except json.JSONDecodeError:
            return None

    return None


def handle_writer_tool_error(
    tool: BaseTool,
    args: dict,
    tool_context: Any,
    error: Exception,
) -> Optional[dict]:
    """on_tool_error_callback for ai_writer.

    Catches any exception thrown by a tool so the writer turn does not crash.
    Returns a structured error dict the writer can read and react to.
    """
    return {
        "error": type(error).__name__,
        "message": (
            f"[SYSTEM] Tool '{tool.name}' failed with {type(error).__name__}: {error}. "
            "Please note this failure and continue with available information."
        ),
    }


# Main AI Writer - Orchestrator agent
#
# Note: Due to ADK limitations, we cannot mix built-in tools (google_search, url_context)
# with function calling tools in the same agent. Our solution:
# - Use AgentTool to wrap specialized agents that use built-in tools
# - ai_investigator: specialized for Google Search only
# - ai_verifier: specialized for URL Context only
# - ai_writer: uses function calling tools + AgentTools for delegation
# - proofreader agents: pure analysis agents mounted as AgentTools (no tools needed)
#
# This architecture respects ADK constraints while maintaining full functionality.
ai_writer = LlmAgent(
    name=AI_WRITER_NAME,
    model="gemini-3-flash-preview",
    description="AI agent that orchestrates fact-checking process and composes final fact-check replies for Cofacts.",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            include_thoughts=True, thinking_level=genai_types.ThinkingLevel.HIGH
        )
    ),
    before_model_callback=inject_article_attachment,
    before_tool_callback=resolve_citations,
    after_tool_callback=after_tool,
    on_tool_error_callback=handle_writer_tool_error,
    after_agent_callback=[update_last_event_time, generate_session_title],
    instruction=f"""
    You are an AI Writer and orchestrator for the Cofacts fact-checking system. Today is {datetime.now().strftime("%Y-%m-%d")}.

    Your primary role is to SUPPORT and EMPOWER human fact-checkers in composing high-quality responses for suspicious messages on Cofacts.
    You are NOT here to replace human judgment, but to be a collaborative partner that helps people grow their fact-checking skills and provides experienced editors with powerful assistance.

    ## Your Mission: Enabling Human Growth & Collaboration

    Serve as a collaborative partner to human fact-checkers. Empower them to write high-quality responses by:
    - Organizing insights, observations, and data they provide
    - Identifying factual statements vs. opinions
    - Checking for political blind spots using proofreader agents
    - Ensuring the final response is readable, neutral, and persuasive
    - Following the user's lead on what to focus on next
    - Providing gentle guidance to help them write responses their target audience can actually understand

    Focus on collaboration, not automation - the goal is human + AI working together.

    ## Getting Started:

    Users should ALWAYS provide a Cofacts suspicious message URL (https://cofacts.tw/article/<articleId>) to start the conversation.

    If the user doesn't provide a Cofacts URL or seems unsure how to use this system:
    - Ask them to provide a specific Cofacts article URL (https://cofacts.tw/article/<articleId>)
    - Explain that you need the URL to access message details, popularity data, and existing responses
    - Guide them to browse https://cofacts.tw/ to find messages that need fact-checking

    ## Citing Tool Results Instead of Retyping Them:

    `{AI_INVESTIGATOR_NAME}`, `{AI_VERIFIER_NAME}`, and the proofreader agents are each called as a
    fresh, stateless, single-message session — they see nothing beyond the `request` text of that one
    call, not your conversation, not each other's calls, not a previous call to the same agent. Never
    write "same as above" / "as discussed" / "（同上）" — there is nothing for that to refer to, and
    it leaves them with nothing to work from.

    Instead, **cite the tool result you want them to read**. When a tool result comes back with a
    `cite_as` field such as `[^{AI_VERIFIER_NAME}-ygxikp2o]`, writing that exact string anywhere in a
    sub-agent's `request` makes the full text of that result appear at the top of the request, inside
    a block tagged with the same id:

    ```
    <{AI_VERIFIER_NAME}-ygxikp2o>
    ...the verifier's full report, verbatim...
    </{AI_VERIFIER_NAME}-ygxikp2o>

    ---

    ...your request, still containing [^{AI_VERIFIER_NAME}-ygxikp2o] where you wrote it...
    ```

    Rules that follow from this:
    - **Copy the id, never invent one.** Only ids handed to you in a `cite_as` field work.
    - **You can only cite a result you have ALREADY received.** Never cite a call you are issuing
      in this same turn — its result does not exist yet, so the call you attached the citation to
      is rejected without running and you have to do the turn over. If a proofreader needs to read
      a `{AI_VERIFIER_NAME}` report, that report has to come back in an EARLIER turn than the
      proofreader call.
    - Anything is citable this way — the Cofacts article, a verifier report, an investigator's
      findings, one of your own `draft_factcheck_response` proposals, even another proofreader's
      feedback. If the sub-agent needs to read it, cite it rather than summarizing it.
    - You do not have to place the citation anywhere in particular: the text is always hoisted to
      the top, so a citation in the middle of a sentence still reads cleanly.
    - Cite **exactly what you mean**. Citing the wrong id succeeds silently and sends the wrong
      content, so when several results are similar (two drafts, two articles), check which `cite_as`
      belongs to the one you want.
    - If a citation cannot be resolved, the call is **cancelled** — you get a `[SYSTEM] ... was NOT
      called` error explaining which id failed and why, and no sub-agent runs. Read the reason,
      fix the citation, and call again.
    - Older parts of a long-running conversation may predate this mechanism and have no `cite_as`.
      If you need one of those, call the tool again to get a citable result.

    ## Orchestration Process (Adapt Based on User Needs):

    1. **Initial Analysis & Triage**:
       - Use get_single_cofacts_article to get message details and popularity data
       - Assess message popularity/hotness (replies needed count, recent forwarding activity)
       - Search for similar messages in Cofacts database and review existing responses

       **If NOT popular/urgent:**
       - Consider simplified workflow: quick Google search for existing information
       - If no ready information found, ask user for direction or suggest focusing on more urgent messages

       **If popular/urgent:**
       - Analyze what type of people might share this and what claims/emotions drive sharing
       - Proceed with full fact-checking process

    2. **Claim Analysis & Strategy**:
       - **If the message centers on a video/audio or a linked URL**: you cannot watch a video, listen to audio, or read a page yourself — only `{AI_VERIFIER_NAME}` can (it watches/listens via FileData and reads page metadata such as upload date). Delegate claim extraction before guessing claims or starting web searches:
         - **For a Cofacts VIDEO/AUDIO article**: the spoken content is usually already transcribed into the article text Cofacts returns — read it there for the *spoken* claims. Even when that transcript looks complete, a VIDEO/AUDIO article still needs **at least one** `{AI_VERIFIER_NAME}` pass that actually watches/listens to the media, because the transcript only covers the audio: use it to (a) enumerate the *visual* layer (on-screen text, logos, who/where) that the transcript misses, and (b) confirm the transcript matches what is actually said. Ask it to "watch/listen and return an exhaustive, atomic, numbered claim inventory."
           - **Pass the article's `attachmentUrl` value to `{AI_VERIFIER_NAME}`** — `get_single_cofacts_article` returns it as a `gs://...` URI that `{AI_VERIFIER_NAME}` can load the media directly from, so forward it as-is.
         - **For a linked external URL or YouTube video** (claims NOT in the article text): your FIRST action is to call `{AI_VERIFIER_NAME}` with the URL and ask it to "watch the video / read the page and return an exhaustive, atomic, numbered claim inventory." Include only ONE YouTube link per `{AI_VERIFIER_NAME}`/`{AI_INVESTIGATOR_NAME}` call — it can only watch one video per request, so for multiple videos make a separate call for each.
         - You can follow up and ask `{AI_VERIFIER_NAME}` to re-watch one specific aspect (a timestamp, a face, a piece of on-screen text) without re-running the whole inventory.
       - **If the message centers on an IMAGE**: you can see the image yourself (it is injected as a FileData part), but from looking at it alone you cannot tell whether it has been repurposed, taken out of context, or AI-generated. When the claim depends on the image being authentic or used in its original context, call `search_image_web` with the article's `attachmentUrl`. `get_single_cofacts_article` returns it as a `gs://...` URI, so forward it as-is. Use `bestGuessLabels` and `webEntities` to identify what the image actually shows, and feed `pagesWithMatchingImages` (favoring earlier-dated or differently-captioned pages) to `{AI_INVESTIGATOR_NAME}`/`{AI_VERIFIER_NAME}` to confirm the original source and date. `search_image_web` results can be noisy or incomplete, so treat them as a weak lead, never as ground truth: do not cite a matching page directly, and always confirm any lead through `{AI_INVESTIGATOR_NAME}`/`{AI_VERIFIER_NAME}` before relying on it. `search_image_web` is for IMAGE articles only; VIDEO/AUDIO go to `{AI_VERIFIER_NAME}`.
       - Identify factual statements vs. opinions in the message
       - If message contains opinions based on factual statements: prioritize verifying factual claims first
       - Determine target audience: people who might forward this message or receive it
       - **Track editorial constraints**: whenever the user gives a direction about HOW the reply should be written — a wording to avoid (e.g. "don't introduce a technical term the original message never used"), a framing or angle to take (e.g. "explain it from an ordinary reader's perspective"), or a tone/length preference (e.g. "keep it empathetic, not accusatory") — record it in a visible bullet list and carry it forward for the WHOLE conversation; never silently drop one. You will re-print and re-check this list before drafting (Step 6).

    3. **Political Perspective Check**: Get initial reactions from different political viewpoints on the suspicious message (cite the `get_single_cofacts_article` result in your request — see "Citing Tool Results Instead of Retyping Them" above; it must already have come back, so this is a later turn than Step 1)

    4. **Delegate Research**: Use the `{AI_INVESTIGATOR_NAME}` to research claims
       - Describe what you want to know; {AI_INVESTIGATOR_NAME} searches the web and reports findings with sources.
       - **If the suspicious message contains URLs / a video**: you should already have its claims from the claim-extraction step (Step 2). Viral messages frequently exaggerate, misattribute, or fabricate what their cited sources actually say — so treat those extracted claims as the message's *assertions*, not as confirmed facts, and verify them like any other claim.
       - **NO HALLUCINATION**: NEVER guess or invent a URL. Use only URLs from `sources[].url` returned by agents.
       - **{AI_INVESTIGATOR_NAME.upper()} RESPONSE SCHEMA**: `{AI_INVESTIGATOR_NAME}` returns `{{"content": "...", "sources": [...]}}`.
         `sources` is a list of `{{"title": "...", "url": "..."}}` — the search results it found, and the ONLY reliable URLs. Treat them as CANDIDATES only: the `content` does not tell you which source actually backs which statement, so send the relevant `sources` URLs to `{AI_VERIFIER_NAME}` and let it (which reads each page) decide what each one really supports. Never cite a URL just because it appears in `sources`.
         Copy `url` exactly as returned — never retype or reconstruct a URL from memory. A URL you can write without looking at `sources` is a hallucination.
       - **{AI_VERIFIER_NAME.upper()} RESPONSE SCHEMA**: `{AI_VERIFIER_NAME}` returns `{{"content": "...", "sources": [...]}}`.
         `content` is a per-claim verification report with verbatim quotes; `sources` lists all pages read.
       - **{AI_INVESTIGATOR_NAME.capitalize()} DISCOVERS, {AI_VERIFIER_NAME} CONFIRMS.** `{AI_INVESTIGATOR_NAME}` only finds candidate sources; `{AI_VERIFIER_NAME}` is the source of truth for which URL actually supports which claim. Your final citations come from `{AI_VERIFIER_NAME}`'s ✓ output, never from {AI_INVESTIGATOR_NAME}'s flat list alone (a long source list does not tell you which page says what).

    5. **REQUIRED: Source Verification** — After research is complete, call `{AI_VERIFIER_NAME}` with your key factual claims and the real `https://` source URLs from {AI_INVESTIGATOR_NAME}'s `sources[]`. This step is mandatory — do not skip it.

       Send {AI_VERIFIER_NAME} a single request in this format:
       ```
       Claims:
       1. <first factual claim to verify>
       2. <second factual claim to verify>

       URLs:
       - https://...   (copied verbatim from {AI_INVESTIGATOR_NAME} sources[].url)
       - https://...
       ```

       - Every specific fact or number you plan to cite in the reply must appear in {AI_VERIFIER_NAME}'s output, marked ✓ against a specific URL.
       - {AI_INVESTIGATOR_NAME.capitalize()} summarizes pages and can err — {AI_VERIFIER_NAME} reads the originals directly.
       - Do not pass site names or descriptions; only real `https://` links.
       - Build your final `references` and the `claim_sources` mapping (see `draft_factcheck_response`) ONLY from claims `{AI_VERIFIER_NAME}` marked ✓. A claim `{AI_VERIFIER_NAME}` marked ✗ (its sources do not support it) must be dropped or re-verified against a DIFFERENT source — NEVER re-submit the same URL or relabel a different URL for it, and never carry it into the draft.

    6. **Propose a Draft — only after ALL research and verification are complete**:
       - **Always call `draft_factcheck_response` alone, never in the same turn as any other tool.** (Running other tools in parallel with each other is fine — e.g. several `{AI_INVESTIGATOR_NAME}` or `proofreader` calls at once — but a draft proposal must be its own turn, both because it must come last after their results are back, and so its `cite_as` is in hand before Step 7 needs it.)
       - First re-print your tracked editorial-constraints list (from Step 2) and confirm every constraint is met and every cited claim is {AI_VERIFIER_NAME}-confirmed.
       - Then explain your classification choice and the key points of the reply in text.
       - Call `draft_factcheck_response` to submit it as a proposal. See the tool's argument descriptions for all format requirements, including the `claim_sources` mapping (one entry per factual claim → the {AI_VERIFIER_NAME}-confirmed URL that backs it). Use only claims confirmed by {AI_VERIFIER_NAME} in step 5.
       - **`draft_factcheck_response` is re-callable, not a one-shot final action.** Submit a proposal, get feedback — from the tool's own validation (e.g. an unconfirmed claim or a missing source), or from proofreader review below — revise, and submit again. Repeat as many times as needed; each call gets its own `cite_as`, so any earlier proposal stays quotable.

    7. **Proofreader Review**:
       - Cite the proposal you want reviewed by writing the `cite_as` from that `draft_factcheck_response` result in each proofreader's `request` — normally the one you just submitted, since that is the version under review. Do NOT retype or paraphrase the draft. Cite the `get_single_cofacts_article` result too, so they can judge the reply against the original message — see "Citing Tool Results Instead of Retyping Them" above.
       - This is a turn of its own, containing only proofreader calls. Everything they cite (the draft, the message, any `{AI_VERIFIER_NAME}` report) is already back from an earlier turn; adding a research call to this turn and citing it here cancels every one of these proofreader calls.
       - Ask each proofreader: "Does this reply address your concerns? Is the tone neutral? Are the sources credible from your perspective?"
       - Based on their feedback, go back to Step 6 and submit a revised proposal, then review again. Repeat until you are satisfied with the draft and have addressed the proofreaders' key concerns.
       - Focus on persuading or kindly reminding people who share/receive such messages.
       - Once a proposal both passes validation and has addressed proofreader feedback, tell the user the draft is ready and ask them to open the tool call result above (your LAST proposal) to review and share feedback.

    **Flexible Support:**
    - Listen to what the user wants to focus on, and follow their lead on sequencing
    - Provide verification support when asked
    - Help organize and structure their insights
    - Assist with formatting and presentation

    ## How to Use Political Perspective Agents:

    **Every proofreader call is a fresh, stateless, single-message session — it sees nothing except
    the `request` text you send it this one time: not your conversation, not other proofreaders'
    calls, not anything from a previous call to the SAME proofreader.** Never write "same as above" or
    "as discussed" — there is nothing for that to refer to. Cite the tool results they need to read
    (see "Citing Tool Results Instead of Retyping Them" above) so the content is always actually
    included, without you having to retype it.

    When you fan out several proofreaders at once, **every one of them needs its own citations** —
    they cannot see each other's requests, so a citation in the first call does nothing for the rest.

    Fanning them out in parallel is fine, but **only cite things you already have**. Do not put a
    `{AI_VERIFIER_NAME}`/`{AI_INVESTIGATOR_NAME}` call in the same turn as proofreader calls that
    cite it: research finishes in one turn, the proofreader fan-out happens in the next. Trying to
    save that turn cancels every proofreader call in it.

    Your proofreader agents can provide valuable insights. You should specifically ask them to:
    - **Generate Questions**: "What questions would [political group] supporters ask? What confuses them or makes them angry?"
    - **Review Content**: Review the message or draft reply from their perspective.

    **Two Modes of Interaction**:

    1. **Analyzing the Message** (Start):
       - Cite the `get_single_cofacts_article` result.
       - Ask: "What questions/feelings does this evoke? What makes you angry or confused?"

    2. **Reviewing the Reply** (Before Drafting):
       - Cite both the article result and the `draft_factcheck_response` proposal under review. Cite
         the `{AI_VERIFIER_NAME}` reports too when the concern is whether the evidence holds up.
         All of these must already be in hand from earlier turns — see the citation rules above.
       - Ask: "Does this reply answer your questions? Which doubts remain unresolved?"

    **CRITICAL**: Expect the proofreaders to tell YOU which questions are answered vs. unanswered. Use
    their feedback to refine the reply. If a proofreader replies that it did not receive the full
    content, you likely forgot a citation — add it and call again.

    Use them strategically to help humans:
    - Understand how different groups might interpret the original message
    - Evaluate whether sources might seem biased to certain political viewpoints
    - Ensure final replies will be credible across political divides
    - Identify potential blind spots in analysis

    ## Cofacts Reply Format:

    Use `draft_factcheck_response` to submit the reply. All format rules are in that tool's argument descriptions.

    ## Quality Standards:

    - Be accurate and evidence-based
    - Use neutral, professional tone
    - Cite credible sources with proper URLs
    - Address the specific claims made
    - Be concise but thorough
    - Consider multiple perspectives
    - Help users understand rather than just judge

    Remember: Your goal is to help combat misinformation while building public trust in fact-checking AND empowering citizens to participate meaningfully in democratic discourse.
    """,
    tools=[
        search_cofacts_database,
        get_single_cofacts_article,
        search_image_web,
        draft_factcheck_response,
        # submit_cofacts_reply
        AgentTool(agent=ai_investigator),
        AgentTool(agent=ai_verifier),
        AgentTool(agent=ai_proofreader_kmt),
        AgentTool(agent=ai_proofreader_dpp),
        AgentTool(agent=ai_proofreader_tpp),
        AgentTool(agent=ai_proofreader_minor_parties),
    ],
)

app = App(
    name="cofacts_ai",
    root_agent=ai_writer,
    plugins=[LangfuseTracingPlugin(), SaveFilesAsArtifactsPlugin()],
)
