"""The /runs routes in main.py, and how it finds ADK's ApiServer.

main.py reaches into get_fast_api_app() for the ApiServer (to share its
Runner and services); if an ADK upgrade moves it, test_finds_adk_server
fails here instead of background runs failing in production.
"""

import asyncio

import fakeredis
import httpx
import pytest
from google.adk.cli.api_server import ApiServer
from google.adk.sessions.in_memory_session_service import InMemorySessionService

import main
from cofacts_ai.run_bus import RunBus
from cofacts_ai.tests.test_run_bus import FakeRunner, script_answer

BASE = "/apps/cofacts_ai/users/u1/sessions/s1"


def test_finds_adk_server():
    server = main._find_adk_server(main.app)
    assert isinstance(server, ApiServer)
    assert server.session_service is not None


@pytest.fixture
async def client(monkeypatch):
    sessions = InMemorySessionService()
    await sessions.create_session(app_name="cofacts_ai", user_id="u1", session_id="s1")
    runner = FakeRunner(sessions, script_answer(delay=0.05))

    async def get_runner():
        return runner

    bus = RunBus(
        redis=fakeredis.FakeAsyncRedis(server=fakeredis.FakeServer()),
        app_name="cofacts_ai",
        get_runner=get_runner,
        session_service=sessions,
    )
    monkeypatch.setattr(main, "run_bus", bus)
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        yield c, bus


async def test_start_status_stream_opened(client):
    c, bus = client
    body = {"newMessage": {"role": "user", "parts": [{"text": "hi"}]}}

    r = await c.post(BASE + "/runs", json=body)
    assert r.status_code == 202 and r.json() == {"invocationId": "e-1"}

    r = await c.post(BASE + "/runs", json=body)
    assert r.status_code == 409 and r.json() == {"invocationId": "e-1"}

    r = await c.get(BASE + "/runs/status")
    assert r.json() == {"running": True, "invocationId": "e-1"}

    r = await c.post(BASE + "/opened")
    assert r.json() == {"deferred": True}

    # httpx's ASGI transport buffers whole bodies, and this one never ends:
    # call the route and read its body until the run's end.
    resp = await main.session_events("cofacts_ai", "u1", "s1")
    assert resp.media_type == "text/event-stream"
    text = ""
    async for chunk in resp.body_iterator:
        text += chunk.decode() if isinstance(chunk, bytes) else chunk
        if "event: end" in text:
            break
    await resp.body_iterator.aclose()
    frames = [f for f in text.split("\n\n") if f]
    # The user message is stored already (history), then the run's 5 frames.
    assert sum(f.startswith("data: {") for f in frames) == 5
    assert frames[-1] == "event: end\ndata: completed"

    while bus.running_count():
        await asyncio.sleep(0.01)
    assert (await c.get(BASE + "/runs/status")).json()["running"] is False
    assert (await c.post(BASE + "/opened")).json() == {"deferred": False}
    assert (await c.post(BASE + "/runs/cancel")).status_code == 404


async def test_unknown_session_is_404(client):
    c, _ = client
    body = {"newMessage": {"role": "user", "parts": [{"text": "hi"}]}}
    r = await c.post("/apps/cofacts_ai/users/u1/sessions/nope/runs", json=body)
    assert r.status_code == 404
    assert (
        await c.post("/apps/cofacts_ai/users/u1/sessions/nope/opened")
    ).status_code == 404
    assert (
        await c.get("/apps/cofacts_ai/users/u1/sessions/nope/events")
    ).status_code == 404


async def test_off_without_redis(monkeypatch):
    monkeypatch.setattr(main, "run_bus", None)
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.get(BASE + "/runs/status")
        # The client falls back to /run_sse only on this exact reason.
        assert r.status_code == 503
        assert r.json() == {"detail": {"reason": "disabled"}}


async def test_shutting_down_is_a_different_503(client):
    c, bus = client
    await bus.shutdown()
    body = {"newMessage": {"role": "user", "parts": [{"text": "hi"}]}}
    r = await c.post(BASE + "/runs", json=body)
    assert r.status_code == 503
    assert r.json() == {"detail": {"reason": "shutting_down"}}
