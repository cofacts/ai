"""What the ai_verifier model actually receives, end to end.

The other tests check one behavior each, mostly by part prefix. This one is
for reading: it runs the production callback chains -- the writer's
`before_tool_callback` and the verifier's `before_model_callback` -- through a
real AgentTool, and asserts the verifier's final `LlmRequest.contents` against
a literal. That list is what Langfuse shows as the verifier's `call_llm` input,
so a change to any injected part's tag or wording shows up here as a diff.

One URL per url-resolver outcome: resolved, DEAD (whose archived copy is
withheld), a fetch failure with an archived copy, and a fetch failure without
one, which gets nothing so url_context has a clean shot at it. The request also
cites the Cofacts message, whose URL arrives inside the hoisted citation and
must not be fetched: cited text is context to read, and the writer asks for a
page only by writing its URL in the request.

The request also carries a YouTube video and a Cofacts media file. Neither is
a web page: url-resolver could only scrape a video page's HTML, so neither is
sent to it and neither gets a page part. Instead each becomes a FileData part
Gemini perceives as media -- the YouTube URL as is, the Cofacts storage URL
converted to its `gs://` form -- appended right after the request text, ahead
of the page parts, because the media callbacks run before the pre-fetch.
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

RESOLVED = "https://news.example.com/live"
DEAD = "https://gone.example.com/a"
ARCHIVED = "https://news.example.com/blocked"
NOTHING = "https://news.example.com/report.pdf"
# Only inside the cited Cofacts message.
CITED = "https://rumor.example.com/post"
# Media, not pages: watched through FileData, never pre-fetched.
YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
MEDIA = (
    "https://storage.googleapis.com/cofacts-media-collection/"
    "production/video/vid1/original"
)
MEDIA_GS = "gs://cofacts-media-collection/production/video/vid1/original"


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
    request it was sent so a test can inspect what the model actually saw."""

    script: list
    seen: list = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.seen.append(llm_request)
        yield LlmResponse(content=self.script.pop(0))


async def test_what_the_verifier_model_receives():
    # --- Setup ---

    # The production callback chains, on agents with scripted models. The
    # system instruction is left out: it is the prompt, not what the callbacks
    # add, and lives in llm_request.config rather than contents anyway.
    verifier = LlmAgent(
        name=ai_verifier.name,
        model=ScriptedLlm(
            model="fake",
            script=[genai_types.ModelContent(parts=[genai_types.Part(text="done")])],
            seen=[],
        ),
        before_model_callback=ai_verifier.before_model_callback,
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
                                name=verifier.name,
                                args={
                                    "request": dedent(f"""\
                                        Check the claim in [^get_single_cofacts_article-art1]: vaccines contain microchips.
                                        {RESOLVED}
                                        {DEAD}
                                        {ARCHIVED}
                                        {NOTHING}
                                        {YOUTUBE}
                                        {MEDIA}""")
                                },
                            )
                        )
                    ]
                ),
                genai_types.ModelContent(parts=[genai_types.Part(text="ok")]),
            ],
            seen=[],
        ),
        tools=[AgentTool(verifier)],
        before_tool_callback=ai_writer.before_tool_callback,
    )
    # One outcome per URL url-resolver is sent.
    resolver = AsyncMock(
        return_value=[
            outcome(
                RESOLVED,
                ResolveStatus.RESOLVED,
                title="Today's news",
                summary="Page text fetched today",
            ),
            outcome(
                DEAD, ResolveStatus.DEAD, error="domain name could not be resolved"
            ),
            outcome(ARCHIVED, ResolveStatus.RESOLVER_CANT_FETCH, error="blocked"),
            outcome(
                NOTHING, ResolveStatus.RESOLVER_CANT_FETCH, error="unsupported type"
            ),
        ]
    )

    runner = InMemoryRunner(agent=writer, app_name="verifier_model_input_test")
    session = await runner.session_service.create_session(
        app_name=runner.app_name, user_id="u"
    )
    # An earlier Cofacts lookup in the writer's history: the message the
    # writer cites, and archived copies of the DEAD URL and of ARCHIVED -- but
    # not of NOTHING.
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
                                    f"Forward this: {CITED}",
                                    "hyperlinks": [
                                        cofacts_link(DEAD),
                                        cofacts_link(ARCHIVED),
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

    # Every web page URL the writer wrote: not CITED, and neither media URL.
    resolver.assert_awaited_once_with([RESOLVED, DEAD, ARCHIVED, NOTHING])
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
                        Vaccines contain microchips! Forward this: {CITED}
                        </get_single_cofacts_article-art1>

                        ---

                        Check the claim in [^get_single_cofacts_article-art1]: vaccines contain microchips.
                        {RESOLVED}
                        {DEAD}
                        {ARCHIVED}
                        {NOTHING}
                        {YOUTUBE}
                        {MEDIA}""")
                ),
                # The media come first, one FileData part each. Vertex AI
                # rejects a FileData without a mime type, and reads `gs://`
                # objects directly with the runtime service account.
                genai_types.Part(
                    file_data=genai_types.FileData(
                        file_uri=YOUTUBE, mime_type="video/webm"
                    )
                ),
                genai_types.Part(
                    file_data=genai_types.FileData(
                        # Typed from the `/video/` segment of the path.
                        file_uri=MEDIA_GS,
                        mime_type="video/mp4",
                    )
                ),
                # Injected notes and pages follow, grouped by kind. NOTHING has
                # no part at all.
                genai_types.Part(
                    text=f"[LINK NOT FOUND] {DEAD}: domain name could not be "
                    "resolved. url-resolver could not resolve this URL (likely "
                    "nonexistent/malformed). Verify with url_context; if it also "
                    "retrieves no content, do NOT claim this link supports any "
                    "claim."
                ),
                genai_types.Part(
                    text=f"[RESOLVED PAGE] {RESOLVED}\n"
                    "TITLE: Today's news\n"
                    "---\n"
                    "Page text fetched today"
                ),
                genai_types.Part(
                    text=f"[ARCHIVED PAGE] {ARCHIVED}\n"
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
