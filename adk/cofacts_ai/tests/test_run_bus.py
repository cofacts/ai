"""Tests for background runs (cofacts_ai/run_bus.py).

Redis is fakeredis, or a real server when TEST_REDIS_URL is set. The runner
is a scripted fake that yields ADK Events the way Runner.run_async does with
yield_user_message=True and stops when its abort_signal is set; sessions
live in ADK's InMemorySessionService so the stored end-of-run events can be
checked.
"""

import asyncio
import json
import os
from types import SimpleNamespace
from typing import Any

import fakeredis
import pytest
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.genai import types

from cofacts_ai import run_bus as rb
from cofacts_ai.run_bus import RunBus, compact_backlog, serialize_event

APP = "cofacts_ai"
USER = "u1"


def text_event(inv, text, *, partial, author="writer"):
    return Event(
        invocation_id=inv,
        author=author,
        partial=partial,
        content=types.Content(role="model", parts=[types.Part(text=text)]),
    )


class FakeRunner:
    """Yields: the user message, then the scripted (delay, event-maker) steps."""

    def __init__(self, session_service, script, inv="e-1"):
        self.agent = SimpleNamespace(name="writer")
        self.session_service = session_service
        self.script = script
        self.inv = inv
        self.calls = 0

    async def run_async(
        self,
        *,
        user_id,
        session_id,
        new_message,
        run_config,
        yield_user_message,
        abort_signal,
    ):
        self.calls += 1
        session = await self.session_service.get_session(
            app_name=APP, user_id=user_id, session_id=session_id
        )
        if session is None:
            from google.adk.errors.session_not_found_error import (
                SessionNotFoundError,
            )

            raise SessionNotFoundError(session_id)
        user_event = Event(invocation_id=self.inv, author="user", content=new_message)
        await self.session_service.append_event(session, user_event)
        assert yield_user_message
        yield user_event
        for delay, make in self.script:
            await asyncio.sleep(delay)
            if abort_signal.is_set():
                return
            ev = make(self.inv)
            if not ev.partial:
                await self.session_service.append_event(session, ev)
            yield ev


def script_answer(n_partials=3, delay=0.02, final_delay=0.02):
    steps: list[tuple[float, Any]] = [
        (delay, lambda inv, i=i: text_event(inv, f"p{i}", partial=True))
        for i in range(n_partials)
    ]
    steps.append(
        (
            final_delay,
            lambda inv: text_event(
                inv, "".join(f"p{i}" for i in range(n_partials)), partial=False
            ),
        )
    )
    return steps


@pytest.fixture
async def redis():
    url = os.environ.get("TEST_REDIS_URL")
    if url:
        from redis.asyncio import Redis

        r = Redis.from_url(url)
        await r.flushdb()
    else:
        r = fakeredis.FakeAsyncRedis(server=fakeredis.FakeServer())
    yield r
    await r.aclose()


@pytest.fixture(autouse=True)
def fast_timings(monkeypatch):
    monkeypatch.setattr(rb, "WRITE_BATCH_SECONDS", 0.005)
    monkeypatch.setattr(rb, "CANCEL_POLL_SECONDS", 0.02)
    monkeypatch.setattr(rb, "STREAM_BLOCK_MS", 200)
    monkeypatch.setattr(rb, "ABORT_GRACE_SECONDS", 0.5)


@pytest.fixture
async def sessions():
    s = InMemorySessionService()
    await s.create_session(app_name=APP, user_id=USER, session_id="s1")
    return s


def make_bus(redis, sessions, runner, owner="owner-a"):
    async def get_runner():
        return runner

    return RunBus(
        redis=redis,
        app_name=APP,
        get_runner=get_runner,
        session_service=sessions,
        owner_id=owner,
    )


def user_msg(text="hi"):
    return types.Content(role="user", parts=[types.Part(text=text)])


async def collect(agen):
    """Parses SSE bytes into ([event dict], heartbeat count)."""
    events, beats = [], 0
    async for chunk in agen:
        for part in chunk.decode().split("\n\n"):
            if part.startswith("data: "):
                events.append(json.loads(part[6:]))
            elif part.startswith(": heartbeat"):
                beats += 1
    return events, beats


async def wait_idle(bus, timeout=5.0):
    async def _wait():
        while bus.running_count():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(_wait(), timeout)


async def test_run_completes_without_any_viewer(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    res = await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    assert res.started and res.invocation_id == "e-1"
    assert (await bus.status(USER, "s1")) == {"running": True, "invocationId": "e-1"}

    await wait_idle(bus)

    assert (await bus.status(USER, "s1"))["running"] is False
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    texts = [e.content.parts[0].text for e in session.events if e.content]
    assert texts == ["hi", "p0p1p2"]  # no run-end event for a finished run
    # Stream is kept a little for slow viewers, then expires.
    assert 0 < await redis.ttl(rb.stream_key(USER, "s1")) <= 30


async def test_viewer_from_start_sees_every_event_then_close(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    events, _ = await asyncio.wait_for(collect(bus.stream(USER, "s1")), 5)

    assert [e.get("partial", False) for e in events] == [False, True, True, True, False]
    assert events[0]["content"]["role"] == "user"
    assert events[-1]["content"]["parts"][0]["text"] == "p0p1p2"
    assert all(e["invocationId"] == "e-1" for e in events)


async def test_late_viewer_gets_backlog_then_live(redis, sessions):
    # Two partials, a long pause, then the rest.
    script = [
        (0.01, lambda inv: text_event(inv, "a", partial=True)),
        (0.01, lambda inv: text_event(inv, "b", partial=True)),
        (0.3, lambda inv: text_event(inv, "c", partial=True)),
        (0.01, lambda inv: text_event(inv, "abc", partial=False)),
    ]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await asyncio.sleep(0.15)  # joins during the pause

    events, _ = await asyncio.wait_for(collect(bus.stream(USER, "s1")), 5)
    texts = [e["content"]["parts"][0]["text"] for e in events]
    assert texts == ["hi", "a", "b", "c", "abc"]


async def test_viewer_disconnect_does_not_stop_the_run(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(delay=0.05)))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())

    agen = bus.stream(USER, "s1")
    await agen.__anext__()
    await agen.aclose()  # browser tab closed

    await wait_idle(bus)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.events[-1].content.parts[0].text == "p0p1p2"


async def test_second_start_gets_409_with_running_invocation(redis, sessions):
    runner = FakeRunner(sessions, script_answer(delay=0.05))
    bus = make_bus(redis, sessions, runner)
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())

    other = make_bus(redis, sessions, runner, owner="owner-b")
    res = await other.start(user_id=USER, session_id="s1", new_message=user_msg("2"))
    assert not res.started and res.invocation_id == "e-1"
    assert runner.calls == 1
    await wait_idle(bus)


async def test_cancel_on_owner_stores_typed_text_and_closes_streams(redis, sessions):
    script = [
        (0.01, lambda inv: text_event(inv, "half ", partial=True)),
        (0.01, lambda inv: text_event(inv, "done", partial=True)),
        (5, lambda inv: text_event(inv, "never", partial=False)),
    ]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    viewer = asyncio.create_task(collect(bus.stream(USER, "s1")))
    await asyncio.sleep(0.1)

    assert await bus.cancel(USER, "s1")
    events, _ = await asyncio.wait_for(viewer, 5)
    await wait_idle(bus)

    last = events[-1]
    assert last["customMetadata"] == {"cofacts_run_end": "cancelled"}
    assert last["content"]["parts"][0]["text"] == "half done"
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    stored = session.events[-1]
    assert stored.custom_metadata == {"cofacts_run_end": "cancelled"}
    assert stored.content.parts[0].text == "half done"
    assert "lastEventTime" in session.state
    assert (await bus.status(USER, "s1"))["running"] is False


async def test_cancel_from_another_process_goes_through_redis(redis, sessions):
    script = [(0.01, lambda inv: text_event(inv, "x", partial=True)), (5, None)]
    owner = make_bus(redis, sessions, FakeRunner(sessions, script))
    await owner.start(user_id=USER, session_id="s1", new_message=user_msg())

    other = make_bus(redis, sessions, None, owner="owner-b")
    assert await other.cancel(USER, "s1")
    await wait_idle(owner)

    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.events[-1].custom_metadata == {"cofacts_run_end": "cancelled"}
    assert await redis.get(rb.cancel_key(USER, "s1")) is None


async def test_cancel_without_run(redis, sessions):
    bus = make_bus(redis, sessions, None)
    assert await bus.cancel(USER, "s1") is False


async def test_stream_without_run_closes_immediately(redis, sessions):
    bus = make_bus(redis, sessions, None)
    assert await asyncio.wait_for(collect(bus.stream(USER, "s1")), 1) == ([], 0)


async def test_stream_ignores_a_previous_runs_leftovers(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(), inv="e-1"))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await wait_idle(bus)

    bus2 = make_bus(redis, sessions, FakeRunner(sessions, script_answer(), inv="e-2"))
    await bus2.start(user_id=USER, session_id="s1", new_message=user_msg("again"))
    events, _ = await asyncio.wait_for(collect(bus2.stream(USER, "s1")), 5)
    assert {e["invocationId"] for e in events} == {"e-2"}


async def test_viewer_closes_when_owner_dies(redis, sessions):
    script = [(0.01, lambda inv: text_event(inv, "x", partial=True)), (60, None)]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    viewer = asyncio.create_task(collect(bus.stream(USER, "s1")))
    await asyncio.sleep(0.05)

    # Simulate the owner process vanishing: its lock expires.
    await redis.delete(rb.lock_key(USER, "s1"))
    events, beats = await asyncio.wait_for(viewer, 5)
    assert [e.get("partial") for e in events] == [None, True]
    assert beats == 0
    for run in list(bus._runs.values()):
        run.task.cancel()


async def test_heartbeat_while_run_is_quiet(redis, sessions):
    script = [(0.5, lambda inv: text_event(inv, "done", partial=False))]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    events, beats = await asyncio.wait_for(collect(bus.stream(USER, "s1")), 5)
    assert beats >= 1
    assert events[-1]["content"]["parts"][0]["text"] == "done"


async def test_mark_opened_is_deferred_while_running(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(delay=0.05)))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    assert await bus.mark_opened(USER, "s1") is True
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert "lastOpenedAt" not in session.state

    await wait_idle(bus)
    assert await bus.mark_opened(USER, "s1") is False
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert isinstance(session.state["lastOpenedAt"], float)


async def test_shutdown_interrupts_runs_and_refuses_new_ones(redis, sessions):
    script = [(0.01, lambda inv: text_event(inv, "par", partial=True)), (60, None)]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await asyncio.sleep(0.05)

    await asyncio.wait_for(bus.shutdown(), 5)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.events[-1].custom_metadata == {"cofacts_run_end": "interrupted"}
    assert session.events[-1].content.parts[0].text == "par"
    assert (await bus.status(USER, "s1"))["running"] is False
    with pytest.raises(rb.RunBusUnavailable):
        await bus.start(user_id=USER, session_id="s1", new_message=user_msg())


async def test_runner_that_ignores_abort_is_cancelled(redis, sessions):
    class Stubborn(FakeRunner):
        async def run_async(self, **kw):
            kw["abort_signal"] = asyncio.Event()  # never sees the abort
            async for ev in super().run_async(**kw):
                yield ev

    script = [(0.01, lambda inv: text_event(inv, "x", partial=True)), (60, None)]
    bus = make_bus(redis, sessions, Stubborn(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await asyncio.sleep(0.05)
    await bus.cancel(USER, "s1")
    await wait_idle(bus)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.events[-1].custom_metadata == {"cofacts_run_end": "cancelled"}


async def test_time_limit_interrupts(redis, sessions, monkeypatch):
    monkeypatch.setenv("RUN_TIMEOUT_SECONDS", "0.1")
    script = [(0.01, lambda inv: text_event(inv, "x", partial=True)), (60, None)]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await wait_idle(bus)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.events[-1].custom_metadata == {"cofacts_run_end": "interrupted"}


async def test_start_on_missing_session_raises_and_releases(redis, sessions):
    from google.adk.errors.session_not_found_error import SessionNotFoundError

    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    with pytest.raises(SessionNotFoundError):
        await bus.start(user_id=USER, session_id="nope", new_message=user_msg())
    await wait_idle(bus)
    assert (await bus.status(USER, "nope"))["running"] is False


async def test_runner_error_after_start_is_sealed_as_interrupted(redis, sessions):
    def boom(inv):
        raise RuntimeError("model blew up")

    script = [(0.01, lambda inv: text_event(inv, "x", partial=True)), (0.01, boom)]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await wait_idle(bus)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.events[-1].custom_metadata == {"cofacts_run_end": "interrupted"}


def test_compact_backlog_keeps_only_the_message_still_being_typed():
    E = rb._Entry
    entries = [
        E("1", "r", "event", False, "user"),
        E("2", "r", "event", True, "a"),
        E("3", "r", "event", False, "a-full"),
        E("4", "r", "event", True, "b"),
        E("5", "r", "event", True, "c"),
    ]
    assert [e.data for e in compact_backlog(entries)] == ["user", "a-full", "b", "c"]


def test_serialize_event_splits_artifact_delta_like_run_sse():
    ev = Event(
        invocation_id="e",
        author="writer",
        content=types.Content(role="model", parts=[types.Part(text="t")]),
        actions=EventActions(artifact_delta={"f.png": 0}),
    )
    first, second = (json.loads(s) for s in serialize_event(ev))
    assert first["content"]["parts"][0]["text"] == "t"
    assert not first["actions"].get("artifactDelta")
    assert "content" not in second and second["actions"]["artifactDelta"] == {
        "f.png": 0
    }
    assert first["invocationId"] == "e"  # camelCase, like /run_sse
