"""Background runs against a real ADK Runner and a real database session store.

test_run_bus.py fakes the runner; this checks the parts that depend on ADK
itself: yield_user_message gives the invocation id, abort_signal ends a run
mid-stream, the end-of-run event (with customMetadata) survives a round trip
through DatabaseSessionService, and nothing trips StaleSessionError. The
model is a fake BaseLlm that streams slowly; no network.
"""

import asyncio
import json
from collections.abc import AsyncGenerator

import fakeredis
import pytest
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions.database_session_service import DatabaseSessionService
from google.genai import types

from cofacts_ai import run_bus as rb
from cofacts_ai.run_bus import RunBus

APP = "cofacts_ai"
USER = "u1"


class SlowModel(BaseLlm):
    """Streams `chunks` with `delay` between them, then the full text."""

    model: str = "slow-fake"
    chunks: list[str] = ["一", "二", "三"]
    delay: float = 0.05

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        for c in self.chunks:
            await asyncio.sleep(self.delay)
            yield LlmResponse(
                content=types.Content(role="model", parts=[types.Part(text=c)]),
                partial=True,
            )
        await asyncio.sleep(self.delay)
        yield LlmResponse(
            content=types.Content(
                role="model", parts=[types.Part(text="".join(self.chunks))]
            ),
            partial=False,
        )


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch):
    monkeypatch.setattr(rb, "WRITE_BATCH_SECONDS", 0.005)
    monkeypatch.setattr(rb, "CANCEL_POLL_SECONDS", 0.02)
    monkeypatch.setattr(rb, "STREAM_BLOCK_MS", 200)


async def make(tmp_path, model):
    sessions = DatabaseSessionService(f"sqlite+aiosqlite:///{tmp_path}/s.db")
    await sessions.create_session(app_name=APP, user_id=USER, session_id="s1")
    runner = Runner(
        app_name=APP,
        agent=LlmAgent(name="writer", model=model, instruction="x"),
        session_service=sessions,
    )

    async def get_runner():
        return runner

    bus = RunBus(
        redis=fakeredis.FakeAsyncRedis(server=fakeredis.FakeServer()),
        app_name=APP,
        get_runner=get_runner,
        session_service=sessions,
    )
    return bus, sessions


async def collect(agen):
    out = []
    async for chunk in agen:
        for part in chunk.decode().split("\n\n"):
            if part.startswith("data: "):
                out.append(json.loads(part[6:]))
    return out


def msg(text):
    return types.Content(role="user", parts=[types.Part(text=text)])


async def test_real_runner_completes_and_streams(tmp_path):
    bus, sessions = await make(tmp_path, SlowModel())
    res = await bus.start(user_id=USER, session_id="s1", new_message=msg("問"))
    assert res.started and res.invocation_id

    events = await asyncio.wait_for(collect(bus.stream(USER, "s1")), 10)
    assert events[0]["content"]["parts"][0]["text"] == "問"
    assert [e.get("partial", False) for e in events[1:]] == [True, True, True, False]
    assert events[-1]["content"]["parts"][0]["text"] == "一二三"
    assert {e["invocationId"] for e in events} == {res.invocation_id}


async def test_real_runner_cancel_persists_typed_text(tmp_path):
    bus, sessions = await make(tmp_path, SlowModel(delay=0.2))
    res = await bus.start(user_id=USER, session_id="s1", new_message=msg("問"))
    viewer = asyncio.create_task(collect(bus.stream(USER, "s1")))
    await asyncio.sleep(0.5)  # two chunks out

    await bus.cancel(USER, "s1")
    events = await asyncio.wait_for(viewer, 10)

    assert events[-1]["customMetadata"] == {"cofacts_run_end": "cancelled"}
    assert events[-1]["content"]["parts"][0]["text"] == "一二"

    # Reload from the database, as a client opening the session later would.
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    last = session.events[-1]
    assert last.invocation_id == res.invocation_id
    assert last.custom_metadata == {"cofacts_run_end": "cancelled"}
    assert last.content.parts[0].text == "一二"
    assert "lastEventTime" in session.state

    # The session is still usable: the next run starts cleanly.
    res2 = await bus.start(user_id=USER, session_id="s1", new_message=msg("再問"))
    assert res2.started
    events2 = await asyncio.wait_for(collect(bus.stream(USER, "s1")), 10)
    assert events2[-1]["content"]["parts"][0]["text"] == "一二三"


async def test_opened_while_running_does_not_break_the_run(tmp_path):
    bus, sessions = await make(tmp_path, SlowModel(delay=0.1))
    await bus.start(user_id=USER, session_id="s1", new_message=msg("問"))
    await asyncio.sleep(0.15)
    assert await bus.mark_opened(USER, "s1") is True  # deferred

    events = await asyncio.wait_for(collect(bus.stream(USER, "s1")), 10)
    assert events[-1]["content"]["parts"][0]["text"] == "一二三"
    assert "customMetadata" not in events[-1]
