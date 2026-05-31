"""
Cofacts AI multi-agent system for fact-checking suspicious messages.

This module implements a hierarchical agent system with:
- AI Writer (orchestrator): Composes fact-check replies and coordinates other agents
- AI Investigator: Deep research using Google Search
- AI Verifier: Verifies claims against provided URLs and sources
- AI Proof-readers: Role-play different political perspectives to test reply effectiveness
"""

import asyncio
import json
import logging
import re
import time
from datetime import datetime
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.apps import App
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import google_search, url_context
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.base_tool import BaseTool
from google.genai import types as genai_types

from .instrumentation import LangfuseTracingPlugin, setup_instrumentation
from .tools import (
    draft_factcheck_response,
    get_single_cofacts_article,
    resolve_vertex_redirect,
    search_cofacts_database,
    submit_cofacts_reply,
)

load_dotenv()

logger = logging.getLogger(__name__)

# Initialize Langfuse instrumentation for observability
setup_instrumentation()

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

    Transforms the raw LLM response into structured JSON {content, sources, grounding_supports}:
    - Resolves grounding chunk redirect URLs in parallel; builds sources[] (1:1 with chunks)
    - Preserves Gemini's grounding_supports segment positions for frontend visualization
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

    # ── C: Build grounding_supports preserving Gemini segment positions ──────
    grounding_supports = []
    seen_texts: set[str] = set()
    for support in metadata.grounding_supports or []:
        seg = support.segment
        if not seg or not seg.text:
            continue
        if seg.text in seen_texts:
            continue
        seen_texts.add(seg.text)
        src_ids = sorted(set(support.grounding_chunk_indices or []))
        grounding_supports.append(
            {
                "segment": {
                    "start_index": seg.start_index,
                    "end_index": seg.end_index,
                    "text": seg.text,
                },
                "source_ids": src_ids,
            }
        )

    # ── Write back as JSON so writer's after_tool_callback gets structured output
    serialized = json.dumps(
        {
            "content": content,
            "sources": sources_list,
            "grounding_supports": grounding_supports,
        },
        ensure_ascii=False,
    )
    return _set_text_content(llm_response, serialized)


async def append_url_context_sources(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """
    After-model callback for ai_verifier.

    Captures clean URL-title pairs from url_context grounding_chunks and wraps
    the response as {content, sources} JSON. Intentionally omits grounding_supports
    (too scattered for url_context). url_context returns real URLs directly —
    no redirect resolution or hallucination stripping needed.
    """
    if not llm_response.grounding_metadata:
        return None
    metadata = llm_response.grounding_metadata
    chunks = metadata.grounding_chunks
    if not chunks or not llm_response.content or not llm_response.content.parts:
        return None

    sources_list = [
        {
            "title": (chunk.web and chunk.web.title) or "Unknown Source",
            "url": chunk.web.uri if chunk.web else None,
        }
        for chunk in chunks
    ]

    content = "".join(p.text or "" for p in llm_response.content.parts)

    serialized = json.dumps(
        {"content": content, "sources": sources_list},
        ensure_ascii=False,
    )
    return _set_text_content(llm_response, serialized)


async def save_search_widget(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Save Google Search Widget HTML as an ADK artifact (Google policy compliance)."""
    metadata = llm_response.grounding_metadata
    if not metadata:
        return None
    if not (
        metadata.search_entry_point and metadata.search_entry_point.rendered_content
    ):
        return None
    filename = f"search-widget-{int(time.time() * 1000)}.html"
    await callback_context.save_artifact(
        filename=filename,
        artifact=genai_types.Part(
            inline_data=genai_types.Blob(
                mime_type="text/html",
                data=metadata.search_entry_point.rendered_content.encode("utf-8"),
            )
        ),
    )
    return None


_YOUTUBE_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/(?:watch\?[^\s\"'<>]*v=|shorts/|live/|embed/|v/)|youtu\.be/)[^\s\"'<>]+"
)


def inject_youtube_filedata(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Before-model callback for ai_investigator and ai_verifier.

    For each user message that contains YouTube URLs, appends FileData parts
    into the same parts array so Gemini can watch the videos inline.
    The original URLs are kept intact so url_context still fetches their
    title/description metadata.

    Ref: https://ai.google.dev/gemini-api/docs/video-understanding#youtube
    """
    try:
        seen = set()
        for content in llm_request.contents:
            if content.role != "user" or not content.parts:
                continue
            youtube_urls = []
            for part in content.parts:
                if part.text:
                    youtube_urls.extend(_YOUTUBE_URL_RE.findall(part.text))
            for url in youtube_urls:
                if url not in seen:
                    seen.add(url)
                    content.parts.append(
                        genai_types.Part(file_data=genai_types.FileData(file_uri=url))
                    )
    except Exception:
        logger.exception("inject_youtube_filedata failed; skipping YouTube injection")
    return None


# AI Web Searcher - Google Search snippet reporter
ai_investigator = LlmAgent(
    name="investigator",
    # Reference: Gemini CLI is also using gemini-3-flash-preview for web-search
    # https://github.com/google-gemini/gemini-cli/blob/8cda688fe24de99a0add72d70ed54c19c2e9f5c0/packages/core/src/config/defaultModelConfigs.ts#L185-L192
    #
    model="gemini-3-flash-preview",
    description="A research assistant you can delegate fact-checking tasks to. Describe what you want to know or investigate; it will search the web, read results, and report back with detailed findings. Returns {content, sources, grounding_supports} — sources lists reliable {title, url} pairs; grounding_supports maps content passages to source indices.",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel.MEDIUM
        )
    ),
    before_model_callback=inject_youtube_filedata,
    after_model_callback=[append_grounding_sources, save_search_widget],
    instruction="""
    You are an AI Investigator for fact-checking. Search the web and faithfully report
    what search results say — do not draw conclusions or form opinions.

    ## CRITICAL RULE — No URLs in Your Text
    Never include any URL, hyperlink, or web address in your response text.
    All source links are extracted automatically from search results by the system.
    Putting URLs in your text would show unverified links to fact-checkers — a serious quality issue.

    ## Your Task

    1. Search Google for information relevant to the claim or question
    2. For each relevant result, report the page title and its content in detail:
       include specific facts, numbers, dates, names, and direct claims from the source.
       The writer needs concrete information — not high-level summaries.
    3. Skip results that are not directly relevant

    ## Key Principles
    - Report faithfully; do not analyze, synthesize, or editorialize
    - The writer draws conclusions — your job is to relay what sources say
    - If sources disagree, report both sides; let the writer reconcile

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
    name="verifier",
    # Reference: Gemini CLI is also using gemini-3-flash-preview for web-fetch
    # https://github.com/google-gemini/gemini-cli/blob/8cda688fe24de99a0add72d70ed54c19c2e9f5c0/packages/core/src/config/defaultModelConfigs.ts#L193-L200
    #
    model="gemini-3-flash-preview",
    description="A fact-checking verifier. Give it URLs to read and claims to check — it reads all pages and returns a per-claim report showing which sources support or refute each claim, with verbatim quotes. Returns {content, sources} — content is the verification report; sources lists {title, url} pairs for all pages read.",
    before_model_callback=inject_youtube_filedata,
    after_model_callback=append_url_context_sources,
    instruction="""
    You are an AI Verifier for fact-checking. Given a list of claims and a list of URLs,
    read all the URLs and determine which sources actually support each claim.

    ## Your Task
    1. Call url_context for ALL provided URLs in one call (up to 20) — this is MANDATORY, even for video URLs.
       url_context fetches web PAGE metadata (title, publish date, description) from the HTML.
       For video URLs like YouTube, page metadata and video frames are complementary:
       - url_context → upload date, uploader name, page title/description
       - FileData → observable video content (speech, visuals, on-screen text)
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

    **When video content is loaded in context**: Report three layers in this order:
    - 「頁面 metadata（url_context 取得）」: uploadDate/publishedAt, uploader, title — quoted verbatim. uploadDate is REQUIRED: a video can show old footage while being recently uploaded, and only the page tells you when it was published online.
    - 「影片標題/描述（上傳者提供）」: quote verbatim — treat as the uploader's claim, not confirmed fact
    - 「影片可觀察內容」: what is visible/audible in the video — speech, on-screen text, logos, surroundings
    The writer has broader context to judge whether the title is accurate or misleading.

    **No invented citations**: The Sources list MUST ONLY contain URLs that were provided as input.
    Never cite a news article, report, or webpage that was not in the original URL list —
    even if you believe such articles exist.
    """,
    tools=[url_context],
)


# AI Proof-reader agents for different Taiwan political perspectives
ai_proofreader_kmt = LlmAgent(
    name="proofreader_kmt",
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

    ## Control Flow:
    If the user wants to continue discussing this message from a KMT perspective, engage with them.
    Otherwise, transfer back to the main AI Writer.

    Provide respectful, measured analysis that helps ensure fact-checking is credible across political divides.
    """,
    tools=[],
)

ai_proofreader_dpp = LlmAgent(
    name="proofreader_dpp",
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

    ## Control Flow:
    If the user wants to continue discussing this message from a DPP perspective, engage with them.
    Otherwise, transfer back to the main AI Writer.

    Provide engaged, democratic analysis that helps ensure fact-checking resonates with progressive audiences.
    """,
    tools=[],
)

ai_proofreader_tpp = LlmAgent(
    name="proofreader_tpp",
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

    ## Control Flow:
    If the user wants to continue discussing this message from a TPP perspective, engage with them.
    Otherwise, transfer back to the main AI Writer.

    Provide rational, balanced analysis that helps ensure fact-checking appeals to moderate voters seeking practical solutions.
    """,
    tools=[],
)

ai_proofreader_minor_parties = LlmAgent(
    name="proofreader_minor_parties",
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

    ## Control Flow:
    If the user wants to continue discussing this message from a minor parties perspective, engage with them.
    Otherwise, transfer back to the main AI Writer.

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
    """Deserializes the JSON response from investigator/verifier into a dict so
    the writer LLM receives structured output."""
    if tool.name not in ("investigator", "verifier"):
        return None
    if not isinstance(tool_response, str):
        return None
    try:
        return json.loads(tool_response)
    except json.JSONDecodeError:
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
# - proofreader agents: pure analysis agents as sub_agents (no tools needed)
#
# This architecture respects ADK constraints while maintaining full functionality.
ai_writer = LlmAgent(
    name="writer",
    model="gemini-3-flash-preview",
    description="AI agent that orchestrates fact-checking process and composes final fact-check replies for Cofacts.",
    generate_content_config=genai_types.GenerateContentConfig(
        thinking_config=genai_types.ThinkingConfig(
            include_thoughts=True, thinking_level=genai_types.ThinkingLevel.HIGH
        )
    ),
    after_tool_callback=after_tool,
    on_tool_error_callback=handle_writer_tool_error,
    after_agent_callback=update_last_event_time,
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
    - Not insisting on rigid processes; adapt to the user's workflow
    - Providing gentle guidance to help them write responses their target audience can actually understand

    Focus on collaboration, not automation - the goal is human + AI working together.

    ## Getting Started:

    Users should ALWAYS provide a Cofacts suspicious message URL (https://cofacts.tw/article/<articleId>) to start the conversation.

    If the user doesn't provide a Cofacts URL or seems unsure how to use this system:
    - Ask them to provide a specific Cofacts article URL (https://cofacts.tw/article/<articleId>)
    - Explain that you need the URL to access message details, popularity data, and existing responses
    - Guide them to browse https://cofacts.tw/ to find messages that need fact-checking

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
       - Identify factual statements vs. opinions in the message
       - If message contains opinions based on factual statements: prioritize verifying factual claims first
       - Determine target audience: people who might forward this message or receive it

    3. **Political Perspective Check**: Get initial reactions from different political viewpoints on the suspicious message

    4. **Delegate Research**: Use the `investigator` to research claims
       - Describe what you want to know; investigator searches the web and reports findings with sources.
       - **If the suspicious message contains URLs**: call `verifier` with those URLs and the message's key claims BEFORE further research. Viral messages frequently exaggerate, misattribute, or fabricate what their cited sources actually say — confirm the source says what the message claims before treating it as evidence.
       - **NO HALLUCINATION**: NEVER guess or invent a URL. Use only URLs from `sources[].url` returned by agents.
       - **INVESTIGATOR RESPONSE SCHEMA**: `investigator` returns `{{"content": "...", "sources": [...], "grounding_supports": [...]}}`.
         `sources` is a list of `{{"title": "...", "url": "..."}}` — the ONLY reliable URLs.
         Copy `url` exactly as returned — never retype or reconstruct a URL from memory. A URL you can write without looking at `sources` is a hallucination.
       - **VERIFIER RESPONSE SCHEMA**: `verifier` returns `{{"content": "...", "sources": [...]}}`.
         `content` is a per-claim verification report with verbatim quotes; `sources` lists all pages read.

    5. **REQUIRED: Source Verification** — After research is complete, call `verifier` with your key factual claims and the real `https://` source URLs from investigator's `sources[]`. This step is mandatory — do not skip it.

       Send verifier a single request in this format:
       ```
       Claims:
       1. <first factual claim to verify>
       2. <second factual claim to verify>

       URLs:
       - https://...   (copied verbatim from investigator sources[].url)
       - https://...
       ```

       - Every specific fact or number you plan to cite in the reply must appear in verifier's output.
       - Investigator summarizes pages and can err — verifier reads the originals directly.
       - Do not pass site names or descriptions; only real `https://` links.

    6. **Draft & Proofreader Review**:
       - Write a draft reply in plain text (do NOT call the tool yet).
       - Send the draft along with the cited sources to the political perspective agents and ask:
         "Does this reply address your concerns? Is the tone neutral? Are the sources credible from your perspective?"
       - Based on their feedback, revise the draft and re-send as needed.
       - Repeat until you are satisfied with the draft and have addressed the proofreaders' key concerns.

    7. **Compose Reply**:
       - Before calling the tool, explain your classification choice and the key points of the reply in text.
       - Call `draft_factcheck_response` — this is the goal of the whole process. See the tool's argument descriptions for all format requirements.
       - Use only claims confirmed by verifier in step 5.
       - Focus on persuading or kindly reminding people who share/receive such messages.
       - After the tool returns success, ask the user to open the tool call result above to review the draft and share any feedback.

    **Flexible Support:**
    - Offer sub-agent capabilities as needed, not as a rigid sequence
    - Listen to what the user wants to focus on
    - Provide verification support when asked
    - Help organize and structure their insights
    - Assist with formatting and presentation

    ## How to Use Political Perspective Agents:

    Your proofreader agents can provide valuable insights. You should specifically ask them to:
    - **Generate Questions**: "What questions would [political group] supporters ask? What confuses them or makes them angry?"
    - **Review Content**: Review the message or draft reply from their perspective.

    **Two Modes of Interaction**:

    1. **Analyzing the Message** (Start):
       - Provide the suspicious message.
       - Ask: "What questions/feelings does this evoke? What makes you angry or confused?"

    2. **Reviewing the Reply** (Before Drafting):
       - Provide the suspicious message AND your draft reply.
       - Ask: "Does this reply answer your questions? Which doubts remain unresolved?"

    **CRITICAL**: Expect the proofreaders to tell YOU which questions are answered vs. unanswered. Use their feedback to refine the reply.

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
    plugins=[LangfuseTracingPlugin()],
)
