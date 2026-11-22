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


async def watch(bus, sid="s1", *, raw=False):
    """Reads a fresh /events feed until the run in progress ends.

    Returns (data frames of the run, heartbeat count); ([], 0) right after
    `synced` when no run is going. History frames are skipped. With raw,
    returns the chunks as received.
    """
    agen = await bus.open_events(USER, sid)
    events, beats, chunks = [], 0, []
    try:
        async for chunk in agen:
            chunks.append(chunk)
            for part in chunk.decode().split("\n\n"):
                if part.startswith("data: "):
                    events.append(json.loads(part[6:]))
                elif part.startswith(": heartbeat"):
                    beats += 1
                elif part.startswith("event: synced"):
                    if '"running": false' in part and not events:
                        return chunks if raw else (events, beats)
                elif part.startswith("event: end"):
                    return chunks if raw else (events, beats)
    finally:
        await agen.aclose()
    return chunks if raw else (events, beats)


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
    events, _ = await asyncio.wait_for(watch(bus), 5)

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

    events, _ = await asyncio.wait_for(watch(bus), 5)
    texts = [e["content"]["parts"][0]["text"] for e in events]
    assert texts == ["hi", "a", "b", "c", "abc"]


async def test_viewer_disconnect_does_not_stop_the_run(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(delay=0.05)))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())

    agen = await bus.open_events(USER, "s1")
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
    viewer = asyncio.create_task(watch(bus))
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
    assert await asyncio.wait_for(watch(bus), 1) == ([], 0)


async def test_stream_ignores_a_previous_runs_leftovers(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(), inv="e-1"))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await wait_idle(bus)

    bus2 = make_bus(redis, sessions, FakeRunner(sessions, script_answer(), inv="e-2"))
    await bus2.start(user_id=USER, session_id="s1", new_message=user_msg("again"))
    events, _ = await asyncio.wait_for(watch(bus2), 5)
    assert {e["invocationId"] for e in events} == {"e-2"}


async def test_viewer_closes_when_owner_dies(redis, sessions):
    script = [(0.01, lambda inv: text_event(inv, "x", partial=True)), (60, None)]
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    viewer = asyncio.create_task(watch(bus))
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
    events, beats = await asyncio.wait_for(watch(bus), 5)
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


async def test_stream_ends_with_the_outcome(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    chunks = await asyncio.wait_for(watch(bus, raw=True), 5)
    assert chunks[-1] == b"event: end\ndata: completed\n\n"


async def test_state_write_holds_off_a_run_start(redis, sessions, monkeypatch):
    """No run can start between write_state()'s check and its write."""
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    gate = asyncio.Event()
    real_append = rb.append_state_delta

    async def slow_append(*a, **kw):
        await gate.wait()
        return await real_append(*a, **kw)

    monkeypatch.setattr(rb, "append_state_delta", slow_append)
    write = asyncio.create_task(bus.write_state(USER, "s1", {"title": "x"}))
    await asyncio.sleep(0.05)
    assert (await bus.status(USER, "s1"))["running"] is False  # not a run
    start = asyncio.create_task(
        bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    )
    await asyncio.sleep(0.1)
    assert not start.done()  # waits for the write
    gate.set()
    assert await write is False
    assert (await start).started
    await wait_idle(bus)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.state["title"] == "x"


async def test_state_write_is_deferred_while_running(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(delay=0.05)))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    assert await bus.write_state(USER, "s1", {"title": "x"}) is True
    await wait_idle(bus)


async def test_start_racing_shutdown_releases_the_lock(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    real_set = redis.set

    async def set_then_shutdown(*a, **kw):
        ok = await real_set(*a, **kw)
        await bus.shutdown()  # SIGTERM lands while start() holds the lock
        return ok

    redis.set = set_then_shutdown
    with pytest.raises(rb.RunBusUnavailable):
        await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    redis.set = real_set
    assert await redis.get(rb.lock_key(USER, "s1")) is None
    assert bus.running_count() == 0


async def test_lock_released_even_if_done_marker_fails(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    real_xadd = redis.xadd

    async def failing_xadd(key, fields, **kw):
        if fields.get("type") == "done":
            raise ConnectionError("redis blip")
        return await real_xadd(key, fields, **kw)

    redis.xadd = failing_xadd
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await wait_idle(bus)
    redis.xadd = real_xadd
    assert await redis.get(rb.lock_key(USER, "s1")) is None


def parse(chunks):
    """(kind, payload) per frame: history / data / end / synced / heartbeat."""
    out = []
    for chunk in chunks:
        for part in chunk.decode().split("\n\n"):
            if not part:
                continue
            if part.startswith(": heartbeat"):
                out.append(("heartbeat", None))
                continue
            kind, data = "data", ""
            for line in part.split("\n"):
                if line.startswith("event: "):
                    kind = line[7:]
                elif line.startswith("data: "):
                    data = line[6:]
            out.append(
                (
                    kind,
                    json.loads(data) if kind in ("data", "history", "synced") else data,
                )
            )
    return out


async def read_until(agen, pred, timeout=5):
    """Reads frames from an open feed until pred(frames) is true."""
    frames = []

    async def _read():
        async for chunk in agen:
            frames.extend(parse([chunk]))
            if pred(frames):
                return

    await asyncio.wait_for(_read(), timeout)
    return frames


def ends(frames):
    return [p for k, p in frames if k == "end"]


async def test_one_feed_carries_run_after_run(redis, sessions):
    """An idle feed wakes for the next run, from any window, and stays open."""
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(), inv="e-1"))
    agen = await bus.open_events(USER, "s1")
    frames = await read_until(agen, lambda f: any(k == "synced" for k, _ in f))
    assert frames[-1] == ("synced", {"running": False})

    await bus.start(user_id=USER, session_id="s1", new_message=user_msg("one"))
    frames = await read_until(agen, lambda f: len(ends(f)) == 1)
    assert ends(frames) == ["completed"]
    assert {p["invocationId"] for k, p in frames if k == "data"} == {"e-1"}

    # Another process starts the next run on the same session.
    other = make_bus(
        redis, sessions, FakeRunner(sessions, script_answer(), inv="e-2"), owner="b"
    )
    await other.start(user_id=USER, session_id="s1", new_message=user_msg("two"))
    frames = await read_until(agen, lambda f: len(ends(f)) == 1)
    data = [p for k, p in frames if k == "data"]
    assert data[0]["content"]["parts"][0]["text"] == "two"
    assert {p["invocationId"] for p in data} == {"e-2"}
    await agen.aclose()
    await wait_idle(other)


async def test_feed_sends_history_after_since(redis, sessions):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await wait_idle(bus)
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    first = session.events[0].id

    agen = await bus.open_events(USER, "s1", since=first)
    frames = await read_until(agen, lambda f: any(k == "synced" for k, _ in f))
    await agen.aclose()
    history = [p["id"] for k, p in frames if k == "history"]
    assert history == [e.id for e in session.events[1:]]

    agen = await bus.open_events(USER, "s1")
    frames = await read_until(agen, lambda f: any(k == "synced" for k, _ in f))
    await agen.aclose()
    assert [p["id"] for k, p in frames if k == "history"] == [
        e.id for e in session.events
    ]


async def test_end_catches_up_what_the_stream_missed(redis, sessions, monkeypatch):
    """A failed batch write loses entries; the end sends them from the store."""
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(delay=0.05)))
    agen = await bus.open_events(USER, "s1")
    await read_until(agen, lambda f: any(k == "synced" for k, _ in f))

    real_xadd = redis.xadd

    async def lose_final_answer(key, fields, **kw):
        data = fields.get("data", "")
        if fields.get("partial") == "0" and "p0p1p2" in data:
            return None  # this entry never reaches Redis
        return await real_xadd(key, fields, **kw)

    monkeypatch.setattr(redis, "xadd", lose_final_answer)
    # pipeline xadd bypasses redis.xadd; drop it at the pipeline level too
    real_pipeline = redis.pipeline

    def pipeline(*a, **kw):
        pipe = real_pipeline(*a, **kw)
        real = pipe.xadd

        def xadd(key, fields, **kw2):
            if fields.get("partial") == "0" and "p0p1p2" in fields.get("data", ""):
                return pipe
            return real(key, fields, **kw2)

        pipe.xadd = xadd
        return pipe

    monkeypatch.setattr(redis, "pipeline", pipeline)
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    frames = await read_until(agen, lambda f: len(ends(f)) == 1)
    await agen.aclose()
    assert not any(
        k == "data"
        and not p.get("partial")
        and p["content"]["parts"][0]["text"] == "p0p1p2"
        for k, p in frames
    )
    i_end = next(i for i, (k, _) in enumerate(frames) if k == "end")
    caught_up = [p for k, p in frames[:i_end] if k == "history"]
    assert [p["content"]["parts"][0]["text"] for p in caught_up] == ["p0p1p2"]


async def test_idle_feeds_share_one_hub_loop(redis, sessions):
    for sid in ("s2", "s3"):
        await sessions.create_session(app_name=APP, user_id=USER, session_id=sid)
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    feeds = []
    for sid in ("s1", "s2", "s3", "s1"):
        agen = await bus.open_events(USER, sid)
        await read_until(agen, lambda f: any(k == "synced" for k, _ in f))
        # The feed subscribes to the hub once it starts waiting.
        feeds.append((agen, asyncio.create_task(agen.__anext__())))
    await asyncio.sleep(0.05)
    assert bus.hub.watching() == 4
    assert len(bus.hub._cursors) == 3  # one XREAD over three keys
    for agen, pending in feeds:
        pending.cancel()
        try:
            await pending
        except (asyncio.CancelledError, StopAsyncIteration):
            pass
        await agen.aclose()
    assert bus.hub.watching() == 0
    await bus.hub.close()


async def test_unknown_session_feed_raises(redis, sessions):
    bus = make_bus(redis, sessions, None)
    with pytest.raises(LookupError):
        await bus.open_events(USER, "nope")


async def test_hub_hands_a_late_subscriber_the_gap(redis, sessions, monkeypatch):
    """A feed whose starting point is behind the hub still gets every entry."""
    script: list[tuple[float, Any]] = [
        (0.05, lambda inv, i=i: text_event(inv, f"p{i}", partial=True))
        for i in range(6)
    ]
    script.append((0.05, lambda inv: text_event(inv, "p0p1p2p3p4p5", partial=False)))
    bus = make_bus(redis, sessions, FakeRunner(sessions, script))
    first = await bus.open_events(USER, "s1")
    await read_until(first, lambda f: any(k == "synced" for k, _ in f))
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    # Window A's feed moves the hub's cursor forward.
    await read_until(first, lambda f: sum(k == "data" for k, _ in f) >= 4)

    # Window B's own XRANGE saw only the first entry (it read just before the
    # rest landed); by the time it subscribes, the hub is far past that.
    real_xrange = redis.xrange
    calls = {"n": 0}

    async def stale_first_read(key, *a, **kw):
        calls["n"] += 1
        rows = await real_xrange(key, *a, **kw)
        return rows[:1] if calls["n"] == 1 else rows

    monkeypatch.setattr(redis, "xrange", stale_first_read)
    second = await bus.open_events(USER, "s1")
    frames = await read_until(second, lambda f: len(ends(f)) == 1)
    await first.aclose()
    await second.aclose()
    texts = [p["content"]["parts"][0]["text"] for k, p in frames if k == "data"]
    assert texts == ["hi", "p0", "p1", "p2", "p3", "p4", "p5", "p0p1p2p3p4p5"]
    assert ends(frames) == ["completed"]


async def test_state_write_waits_out_another_state_write(redis, sessions):
    bus = make_bus(redis, sessions, None)
    key = rb.lock_key(USER, "s1")
    await redis.set(key, json.dumps({"stateWrite": "other"}), px=5000)

    async def release_soon():
        await asyncio.sleep(0.2)
        await redis.delete(key)

    releaser = asyncio.create_task(release_soon())
    assert await bus.write_state(USER, "s1", {"title": "x"}) is False
    await releaser
    session = await sessions.get_session(app_name=APP, user_id=USER, session_id="s1")
    assert session.state["title"] == "x"


async def test_feed_ends_a_run_whose_end_it_never_saw(redis, sessions, monkeypatch):
    monkeypatch.setattr(rb, "STREAM_BLOCK_MS", 10_000)  # no timeout path here
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer(), inv="e-1"))
    agen = await bus.open_events(USER, "s1")
    await read_until(agen, lambda f: any(k == "synced" for k, _ in f))

    real_xadd = redis.xadd

    async def lose_done(key, fields, **kw):
        if fields.get("type") == "done":
            return None
        return await real_xadd(key, fields, **kw)

    monkeypatch.setattr(redis, "xadd", lose_done)
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg("one"))
    # The feed sees run 1 all the way to its answer, but never its done.
    run1 = await read_until(
        agen,
        lambda f: any(
            k == "data" and not p.get("partial") and p["author"] == "writer"
            for k, p in f
        ),
    )
    await wait_idle(bus)
    monkeypatch.setattr(redis, "xadd", real_xadd)

    other = make_bus(
        redis, sessions, FakeRunner(sessions, script_answer(), inv="e-2"), owner="b"
    )
    await other.start(user_id=USER, session_id="s1", new_message=user_msg("two"))
    frames = await read_until(agen, lambda f: len(ends(f)) == 2)
    await agen.aclose()
    await wait_idle(other)
    assert {p["invocationId"] for k, p in run1 if k == "data"} == {"e-1"}
    first_end = next(i for i, (k, _) in enumerate(frames) if k == "end")
    assert ends(frames) == ["interrupted", "completed"]
    assert {p["invocationId"] for k, p in frames[first_end + 1 :] if k == "data"} == {
        "e-2"
    }


async def test_start_releases_the_lock_if_it_fails_after_taking_it(
    redis, sessions, monkeypatch
):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))

    async def boom(*a, **kw):
        raise ConnectionError("redis blip")

    monkeypatch.setattr(redis, "delete", boom)
    with pytest.raises(ConnectionError):
        await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    assert await redis.get(rb.lock_key(USER, "s1")) is None
    assert bus.running_count() == 0


async def test_run_failing_before_its_first_event_ends_as_interrupted(redis, sessions):
    class Broken(FakeRunner):
        async def run_async(self, **kw):
            raise RuntimeError("runner failed to load")
            yield  # pragma: no cover

    bus = make_bus(redis, sessions, Broken(sessions, []))
    agen = await bus.open_events(USER, "s1")
    await read_until(agen, lambda f: any(k == "synced" for k, _ in f))
    with pytest.raises(RuntimeError):
        await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    frames = await read_until(agen, lambda f: len(ends(f)) == 1)
    await agen.aclose()
    assert ends(frames) == ["interrupted"]


async def test_end_catch_up_reads_only_the_run(redis, sessions, monkeypatch):
    bus = make_bus(redis, sessions, FakeRunner(sessions, script_answer()))
    configs = []
    real_get = sessions.get_session

    async def spy(**kw):
        configs.append(kw.get("config"))
        return await real_get(**kw)

    agen = await bus.open_events(USER, "s1")
    await read_until(agen, lambda f: any(k == "synced" for k, _ in f))
    monkeypatch.setattr(sessions, "get_session", spy)
    await bus.start(user_id=USER, session_id="s1", new_message=user_msg())
    await read_until(agen, lambda f: len(ends(f)) == 1)
    await agen.aclose()
    catch_up = [c for c in configs if c is not None]
    assert catch_up and catch_up[-1].after_timestamp is not None
