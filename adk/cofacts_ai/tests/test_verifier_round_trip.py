"""One ai_writer -> ai_verifier call, end to end, read from both models' side.

The other tests check one behavior each, mostly by part prefix. This one is
for reading: it runs the production callback chains -- the writer's
`before_tool_callback` and `after_tool_callback`, the verifier's
`before_model_callback` and `after_model_callback` -- through a real
AgentTool, with a scripted model on both sides, and asserts two literals: what
the verifier's model is sent, and what the writer's model gets back. Those are
what Langfuse shows as each agent's `call_llm` input, so a change to any
injected part's tag or wording, or to the shape of the result, shows up here as
a diff.

The writer's request names one URL per url-resolver outcome: resolved, DEAD
(whose archived copy is withheld), a fetch failure with an archived copy, and
a fetch failure without one, which gets nothing so url_context has a clean shot
at it. It also cites the Cofacts message, whose URL arrives inside the hoisted
citation and must not be fetched: cited text is context to read, and the writer
asks for a page only by writing its URL in the request.

The request also carries a YouTube video and a Cofacts media file, and each
becomes a FileData part Gemini perceives as media, appended right after the
request text, ahead of the page parts, because the media callbacks run before
the pre-fetch. The YouTube URL is also sent to url-resolver like any web page,
which returns the video page's title and description as a page part. The
Cofacts media file is not: the writer forwards it in its `gs://` form, which is
not an http(s) URL, so it is never extracted.

The verifier's model then answers with url_context grounding for the one page
url-resolver could not read: the PDF. What the writer gets back is that report
plus `sources`, the pages the verifier actually read this call -- the union of
what url-resolver resolved and what url_context grounded. So the resolved page,
the YouTube video and the PDF are listed, and nothing else is: the dead link
was read by neither, and the archived page was read only as Cofacts' old copy,
which is background, never a source. `sources` is what the writer may cite, so
a URL that sneaks in here is one a published reply can claim the verifier read.
"""

from textwrap import dedent
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

from google.adk.agents import LlmAgent
from google.adk.events import Event
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.adk.tools.agent_tool import AgentTool
from google.genai import types as genai_types

from cofacts_ai.agent import ai_verifier, ai_writer
from cofacts_ai.url_resolver.client import ResolvedUrl, ResolveStatus

RESOLVED_URL = "https://news.example.com/live"
DEAD_URL = "https://gone.example.com/a"
ARCHIVED_URL = "https://news.example.com/blocked"
NOTHING_URL = "https://news.example.com/report.pdf"
# Only inside the cited Cofacts message.
CITED_URL = "https://rumor.example.com/post"
# Watched through FileData, and pre-fetched for its page metadata.
YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
# Watched through FileData only. `gs://`, as the writer forwards it: not an
# http(s) URL, so never pre-fetched.
MEDIA_URL = "gs://cofacts-media-collection/production/video/vid1/original"


def outcome(
    url: str,
    status: ResolveStatus,
    *,
    title: str | None = None,
    summary: str | None = None,
    error: str | None = None,
) -> ResolvedUrl:
    return ResolvedUrl(
        url=url,
        canonical=url if status == ResolveStatus.RESOLVED else None,
        title=title,
        summary=summary,
        http_status=200 if status == ResolveStatus.RESOLVED else None,
        status=status,
        error=error,
    )


def cofacts_link(url: str) -> dict:
    """A hyperlink as Cofacts stored it from its own earlier crawl."""
    return {
        "url": url,
        "title": "Old title",
        "summary": "Page text Cofacts crawled back then",
        "fetchedAt": "2018-09-25T00:00:00.000Z",
        "status": "0",
        "error": None,
    }


class ScriptedLlm(BaseLlm):
    """Replies from a script, one response per model call, and keeps every
    request it was sent so a test can inspect what the model actually saw.

    A script entry is either the reply's content or, when the reply needs more
    than that (e.g. grounding metadata), the whole LlmResponse."""

    script: list
    seen: list = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.seen.append(llm_request)
        reply = self.script.pop(0)
        yield reply if isinstance(reply, LlmResponse) else LlmResponse(content=reply)


async def test_one_verifier_call():
    # --- Setup ---

    # The production callback chains, on agents with scripted models. The
    # system instruction is left out: it is the prompt, not what the callbacks
    # add, and lives in llm_request.config rather than contents anyway.
    verifier = LlmAgent(
        name=ai_verifier.name,
        model=ScriptedLlm(
            model="fake",
            script=[
                # The verifier's report. url_context grounds only the PDF: the
                # one page url-resolver could not read for it.
                LlmResponse(
                    content=genai_types.ModelContent(
                        parts=[
                            genai_types.Part(text="No page says vaccines hold chips.")
                        ]
                    ),
                    grounding_metadata=genai_types.GroundingMetadata(
                        grounding_chunks=[
                            genai_types.GroundingChunk(
                                web=genai_types.GroundingChunkWeb(
                                    uri=NOTHING_URL, title="Annual report"
                                )
                            )
                        ]
                    ),
                )
            ],
            seen=[],
        ),
        # Under test: the verifier's production before_model_callback chain.
        before_model_callback=ai_verifier.before_model_callback,
        # Under test: the verifier's production after_model_callback, which
        # builds `sources`.
        after_model_callback=ai_verifier.after_model_callback,
    )
    # Calls the verifier once, with a request naming every kind of URL.
    writer = LlmAgent(
        name="writer",
        model=ScriptedLlm(
            model="fake",
            script=[
                genai_types.ModelContent(
                    parts=[
                        genai_types.Part(
                            function_call=genai_types.FunctionCall(
                                # Gemini sends no id, so ADK mints a random
                                # `adk-` one; fixed here so `cite_as` below is
                                # a literal.
                                id="adk-verify01",
                                name=verifier.name,
                                args={
                                    "request": dedent(f"""\
                                        Check the claim in [^get_single_cofacts_article-art1]: vaccines contain microchips.
                                        {RESOLVED_URL}
                                        {DEAD_URL}
                                        {ARCHIVED_URL}
                                        {NOTHING_URL}
                                        {YOUTUBE_URL}
                                        {MEDIA_URL}""")
                                },
                            )
                        )
                    ]
                ),
                # Ends the writer's turn once the tool returns; its text is
                # never checked.
                genai_types.ModelContent(parts=[genai_types.Part(text="ok")]),
            ],
            seen=[],
        ),
        tools=[AgentTool(verifier)],
        # Under test: the writer's production before_tool_callback chain.
        before_tool_callback=ai_writer.before_tool_callback,
        # Under test: the writer's production after_tool_callback, which turns
        # the verifier's JSON reply into the dict its model reads and stamps
        # it with `cite_as`.
        after_tool_callback=ai_writer.after_tool_callback,
    )
    # One outcome per URL url-resolver is sent.
    resolver = AsyncMock(
        return_value=[
            outcome(
                RESOLVED_URL,
                ResolveStatus.RESOLVED,
                title="Today's news",
                summary="Page text fetched today",
            ),
            outcome(
                DEAD_URL, ResolveStatus.DEAD, error="domain name could not be resolved"
            ),
            outcome(ARCHIVED_URL, ResolveStatus.RESOLVER_CANT_FETCH, error="blocked"),
            outcome(
                NOTHING_URL, ResolveStatus.RESOLVER_CANT_FETCH, error="unsupported type"
            ),
            outcome(
                YOUTUBE_URL,
                ResolveStatus.RESOLVED,
                title="Rick Astley - Never Gonna Give You Up",
                summary="The official video for Never Gonna Give You Up",
            ),
        ]
    )

    runner = InMemoryRunner(agent=writer, app_name="verifier_round_trip_test")
    session = await runner.session_service.create_session(
        app_name=runner.app_name, user_id="u"
    )
    # An earlier Cofacts lookup in the writer's history: the message the
    # writer cites, and archived copies of DEAD_URL and of ARCHIVED_URL -- but
    # not of NOTHING_URL.
    await runner.session_service.append_event(
        session,
        Event(
            author="writer",
            content=genai_types.Content(
                role="user",
                parts=[
                    genai_types.Part(
                        function_response=genai_types.FunctionResponse(
                            id="art1",
                            name="get_single_cofacts_article",
                            response={
                                "cite_as": "[^get_single_cofacts_article-art1]",
                                "article": {
                                    "text": "Vaccines contain microchips! "
                                    f"Forward this: {CITED_URL}",
                                    "hyperlinks": [
                                        cofacts_link(DEAD_URL),
                                        cofacts_link(ARCHIVED_URL),
                                    ],
                                },
                            },
                        )
                    )
                ],
            ),
        ),
    )

    # --- Run ---

    with patch("cofacts_ai.resolved_pages.resolve_urls", resolver):
        async for _ in runner.run_async(
            user_id="u",
            session_id=session.id,
            new_message=genai_types.UserContent(parts=[genai_types.Part(text="Go on")]),
        ):
            pass

    # --- Assert ---

    # Every http(s) URL the writer wrote: not CITED_URL, and not the `gs://`
    # MEDIA_URL.
    resolver.assert_awaited_once_with(
        [RESOLVED_URL, DEAD_URL, ARCHIVED_URL, NOTHING_URL, YOUTUBE_URL]
    )
    # The one request the verifier's model was sent.
    assert isinstance(verifier.model, ScriptedLlm)
    [request] = verifier.model.seen
    assert request.contents == [
        genai_types.Content(
            role="user",
            parts=[
                # The writer's request with the cited message hoisted above it,
                # and the archived-links block it staged already taken back out.
                genai_types.Part(
                    text=dedent(f"""\
                        <get_single_cofacts_article-art1>
                        Vaccines contain microchips! Forward this: {CITED_URL}
                        </get_single_cofacts_article-art1>

                        ---

                        Check the claim in [^get_single_cofacts_article-art1]: vaccines contain microchips.
                        {RESOLVED_URL}
                        {DEAD_URL}
                        {ARCHIVED_URL}
                        {NOTHING_URL}
                        {YOUTUBE_URL}
                        {MEDIA_URL}""")
                ),
                # The media come first, one FileData part each. Vertex AI
                # rejects a FileData without a mime type, and reads `gs://`
                # objects directly with the runtime service account.
                genai_types.Part(
                    file_data=genai_types.FileData(
                        file_uri=YOUTUBE_URL, mime_type="video/webm"
                    )
                ),
                genai_types.Part(
                    file_data=genai_types.FileData(
                        # Typed from the `/video/` segment of the path.
                        file_uri=MEDIA_URL,
                        mime_type="video/mp4",
                    )
                ),
                # Injected notes and pages follow, grouped by kind. NOTHING_URL has
                # no part at all.
                genai_types.Part(
                    text=f"[LINK NOT FOUND] {DEAD_URL}: domain name could not be "
                    "resolved. url-resolver could not resolve this URL (likely "
                    "nonexistent/malformed). Verify with url_context; if it also "
                    "retrieves no content, do NOT claim this link supports any "
                    "claim."
                ),
                genai_types.Part(
                    text=f"[RESOLVED PAGE] {RESOLVED_URL}\n"
                    "TITLE: Today's news\n"
                    "---\n"
                    "Page text fetched today"
                ),
                genai_types.Part(
                    text=f"[RESOLVED PAGE] {YOUTUBE_URL}\n"
                    "TITLE: Rick Astley - Never Gonna Give You Up\n"
                    "---\n"
                    "The official video for Never Gonna Give You Up"
                ),
                genai_types.Part(
                    text=f"[ARCHIVED PAGE] {ARCHIVED_URL}\n"
                    "TITLE: Old title\n"
                    "url-resolver could not reach this page just now. The text "
                    "below is what Cofacts crawled on 2018-09-25, NOT what the "
                    "page says today — it may have changed or gone. Use it as "
                    "background only: do not treat it as confirmation that this "
                    "link currently supports a claim, and prefer url_context if "
                    "that can still read the page.\n"
                    "---\n"
                    "Page text Cofacts crawled back then"
                ),
            ],
        )
    ]

    # What the writer's model gets back: the last turn of its second request.
    assert isinstance(writer.model, ScriptedLlm)
    assert writer.model.seen[1].contents[-1] == genai_types.Content(
        role="user",
        parts=[
            genai_types.Part(
                function_response=genai_types.FunctionResponse(
                    name=verifier.name,
                    response={
                        "content": "No page says vaccines hold chips.",
                        "sources": [
                            # Read by url-resolver, and listed under the URL the
                            # writer asked about.
                            {"title": "Today's news", "url": RESOLVED_URL},
                            # Read by url-resolver too, so listed whether or not
                            # url_context grounds it.
                            {
                                "title": "Rick Astley - Never Gonna Give You Up",
                                "url": YOUTUBE_URL,
                            },
                            # url-resolver could not fetch it, but url_context
                            # grounded it.
                            {"title": "Annual report", "url": NOTHING_URL},
                            # No DEAD_URL: a dead link is never a source.
                            # No ARCHIVED_URL: the verifier read Cofacts' archived
                            # copy, but archived text is never a source.
                        ],
                        "cite_as": "[^verifier-verify01]",
                        "cite_hint": "To let a sub-agent read this result in "
                        "full, write [^verifier-verify01] in its `request`.",
                    },
                )
            )
        ],
    )
