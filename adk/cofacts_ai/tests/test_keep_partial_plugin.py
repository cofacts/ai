"""KeepPartialOnAbortPlugin against a real ADK Runner.

These run the actual abort path (``run_async(abort_signal=...)``, which is
what ``/run_sse`` uses when the client disconnects), so an ADK upgrade that
stops passing the abort event through ``on_event_callback`` fails here.
"""

import asyncio
from typing import cast

from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.apps import App
from google.adk.events.event import Event
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from cofacts_ai.keep_partial_plugin import (
    INVOCATION_ABORTED,
    KeepPartialOnAbortPlugin,
)


def _text(text: str, *, partial: bool) -> LlmResponse:
    return LlmResponse(
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        partial=partial,
    )


class StreamingModel(BaseLlm):
    """Streams ``chunks`` and then waits, so the test can abort mid-message.

    With ``finish_first``, the first response is a whole message plus a tool
    call, stored before the next response streams: an earlier message of the
    same turn.
    """

    model: str = "fake-streaming"
    chunks: list[str] = []
    finish_first: bool = False

    async def generate_content_async(self, llm_request, stream=False):
        answered = any(
            part.function_response
            for content in llm_request.contents
            for part in content.parts or []
        )
        if self.finish_first and not answered:
            yield _text("先講完的話。", partial=True)
            yield LlmResponse(
                content=types.Content(
                    role="model",
                    parts=[
                        types.Part(text="先講完的話。"),
                        types.Part(
                            function_call=types.FunctionCall(
                                id="call-1", name="look_up", args={}
                            )
                        ),
                    ],
                ),
                partial=False,
            )
            return
        for chunk in self.chunks:
            yield _text(chunk, partial=True)
        await asyncio.sleep(30)  # the stop arrives while this waits
        yield _text("".join(self.chunks) + "沒講完的部分。", partial=False)


def look_up() -> dict:
    """A tool the fake model calls between its two messages."""
    return {"ok": True}


async def _run_and_abort(model: StreamingModel, partials_before_abort: int):
    sessions = InMemorySessionService()
    agent = LlmAgent(name="writer", model=model, instruction="x", tools=[look_up])
    runner = Runner(
        app=App(
            name="cofacts_ai",
            root_agent=agent,
            plugins=[KeepPartialOnAbortPlugin()],
        ),
        session_service=sessions,
    )
    session = await sessions.create_session(app_name="cofacts_ai", user_id="u")
    abort = asyncio.Event()
    seen = 0

    async def drain():
        nonlocal seen
        async for event in runner.run_async(
            user_id="u",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text="hi")]),
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
            abort_signal=abort,
        ):
            if event.partial:
                seen += 1
                if seen == partials_before_abort:
                    abort.set()

    await asyncio.wait_for(drain(), timeout=10)
    stored = await sessions.get_session(
        app_name="cofacts_ai", user_id="u", session_id=session.id
    )
    assert stored is not None
    return stored.events


def _texts(event) -> str:
    return "".join(p.text or "" for p in (event.content.parts if event.content else []))


async def test_stopped_message_is_kept_on_the_abort_event():
    model = StreamingModel(chunks=["第一段。", "第二段。", "第三段。"])
    events = await _run_and_abort(model, partials_before_abort=3)

    abort = events[-1]
    assert abort.error_code == INVOCATION_ABORTED
    assert abort.author == "writer"
    assert abort.content is not None and abort.content.role == "model"
    assert _texts(abort) == "第一段。第二段。第三段。"
    # Only the user message and the abort event: no partial was stored.
    assert [e.author for e in events] == ["user", "writer"]


async def test_abort_before_any_text_stays_empty():
    model = StreamingModel(chunks=[])
    # Nothing streams, so abort right away from outside.
    sessions_events = None

    async def run():
        nonlocal sessions_events
        sessions = InMemorySessionService()
        runner = Runner(
            app=App(
                name="cofacts_ai",
                root_agent=LlmAgent(name="writer", model=model, instruction="x"),
                plugins=[KeepPartialOnAbortPlugin()],
            ),
            session_service=sessions,
        )
        session = await sessions.create_session(app_name="cofacts_ai", user_id="u")
        abort = asyncio.Event()
        asyncio.get_running_loop().call_later(0.2, abort.set)
        async for _ in runner.run_async(
            user_id="u",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text="hi")]),
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
            abort_signal=abort,
        ):
            pass
        stored = await sessions.get_session(
            app_name="cofacts_ai", user_id="u", session_id=session.id
        )
        assert stored is not None
        sessions_events = stored.events

    await asyncio.wait_for(run(), timeout=10)
    assert sessions_events is not None
    abort = sessions_events[-1]
    assert abort.error_code == INVOCATION_ABORTED
    assert abort.content is None


async def test_text_already_stored_is_not_repeated():
    model = StreamingModel(chunks=["新的一段。"], finish_first=True)
    # Partial 1 is the finished message's, partial 2 the new one's.
    events = await _run_and_abort(model, partials_before_abort=2)

    assert [e.author for e in events] == ["user", "writer", "writer", "writer"]
    assert _texts(events[1]) == "先講完的話。"
    assert events[2].get_function_responses()
    assert events[-1].error_code == INVOCATION_ABORTED
    assert _texts(events[-1]) == "新的一段。"


async def test_thoughts_are_not_kept():
    plugin = KeepPartialOnAbortPlugin()
    ctx = cast(InvocationContext, None)  # unused by the plugin

    def partial(parts):
        return Event(
            invocation_id="inv",
            author="writer",
            partial=True,
            content=types.Content(role="model", parts=parts),
        )

    await plugin.on_event_callback(
        invocation_context=ctx,
        event=partial([types.Part(text="想一想", thought=True)]),
    )
    await plugin.on_event_callback(
        invocation_context=ctx,
        event=partial([types.Part(text="答案")]),
    )
    kept = await plugin.on_event_callback(
        invocation_context=ctx,
        event=Event(
            invocation_id="inv", author="writer", error_code=INVOCATION_ABORTED
        ),
    )
    assert kept is not None and _texts(kept) == "答案"
