"""CofactsSessionService against a real database, and a real ADK Runner.

The bug (cofacts/ai#204): ADK's PATCH /sessions/{id} appends a state-only
``p-`` event, which moves ``sessions.update_time``. A turn that loaded the
session before that PATCH then fails its next append with StaleSessionError.
These tests replay that sequence with two copies of one session, the way the
running turn and the PATCH handler each hold one.

Runs on SQLite. Set TEST_POSTGRES_URL (``postgresql+asyncpg://...``, an empty
database the tests may create tables in) to also run them on PostgreSQL, where
production keeps sessions and row locks are real.
"""

from __future__ import annotations

import os
import sys
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from google.adk.agents.llm_agent import LlmAgent
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.cli.service_registry import get_service_registry
from google.adk.cli.utils.service_factory import create_session_service_from_options
from google.adk.errors._stale_session_error import StaleSessionError
from google.adk.events.event import Event, EventActions
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions.database_session_service import DatabaseSessionService
from google.adk.sessions.sqlite_session_service import SqliteSessionService
from google.adk.tools.function_tool import FunctionTool
from google.genai import types

from cofacts_ai.session_service import (
    CofactsSessionService,
    is_state_only_write,
    register_session_services,
)

APP = "cofacts_ai"
USER = "u1"

_URLS = ["sqlite"]
if os.environ.get("TEST_POSTGRES_URL"):
    _URLS.append("postgres")


@pytest.fixture(params=_URLS)
def db_url(request, tmp_path) -> str:
    if request.param == "sqlite":
        return f"sqlite+aiosqlite:///{tmp_path}/sessions.db"
    return os.environ["TEST_POSTGRES_URL"]


@pytest.fixture
async def service(db_url) -> AsyncGenerator[CofactsSessionService, None]:
    svc = CofactsSessionService(db_url)
    yield svc
    await svc.close()


@pytest.fixture
async def plain_service(db_url) -> AsyncGenerator[DatabaseSessionService, None]:
    svc = DatabaseSessionService(db_url)
    yield svc
    await svc.close()


def patch_event(state_delta: dict) -> Event:
    """The event ADK's PATCH /apps/{app}/users/{user}/sessions/{id} appends."""
    return Event(
        invocation_id="p-" + str(uuid.uuid4()),
        author="user",
        actions=EventActions(state_delta=state_delta),
    )


def turn_event(text: str, state_delta: dict | None = None) -> Event:
    return Event(
        invocation_id="e-turn",
        author="writer",
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        actions=EventActions(state_delta=state_delta or {}),
    )


async def new_session(svc: DatabaseSessionService) -> str:
    session_id = str(uuid.uuid4())  # unique, so a shared Postgres needs no cleanup
    await svc.create_session(
        app_name=APP, user_id=USER, session_id=session_id, state={"title": "t"}
    )
    return session_id


async def load(svc: DatabaseSessionService, session_id: str):
    session = await svc.get_session(app_name=APP, user_id=USER, session_id=session_id)
    assert session is not None
    return session


async def test_plain_adk_service_kills_the_turn(plain_service):
    """Documents the ADK behaviour this module exists for. If an ADK upgrade
    makes this pass without raising, the override may no longer be needed."""
    sid = await new_session(plain_service)
    turn = await load(plain_service, sid)
    await plain_service.append_event(turn, turn_event("calling verifier"))

    await plain_service.append_event(
        await load(plain_service, sid), patch_event({"lastOpenedAt": 1.0})
    )

    with pytest.raises(StaleSessionError):
        await plain_service.append_event(turn, turn_event("verifier returned"))


async def test_patch_mid_turn_keeps_the_turn_going(service):
    sid = await new_session(service)
    turn = await load(service, sid)
    await service.append_event(turn, turn_event("calling verifier"))
    before = (await load(service, sid)).last_update_time

    patched = await load(service, sid)
    returned = await service.append_event(patched, patch_event({"lastOpenedAt": 1.0}))

    # The PATCH response (ADK returns the caller's copy) carries the new state.
    assert returned.actions.state_delta == {"lastOpenedAt": 1.0}
    assert patched.state["lastOpenedAt"] == 1.0
    # No new revision: update_time (the marker) and lastUpdateTime didn't move.
    assert (await load(service, sid)).last_update_time == before

    await service.append_event(
        turn, turn_event("verifier returned", {"lastEventTime": 2.0})
    )

    stored = await load(service, sid)
    assert stored.state == {"title": "t", "lastOpenedAt": 1.0, "lastEventTime": 2.0}
    texts = [e.content.parts[0].text for e in stored.events if e.content]
    assert texts == ["calling verifier", "verifier returned"]
    # The PATCH event is still kept in the history, as ADK would.
    assert [e.invocation_id[:2] for e in stored.events].count("p-") == 1


async def test_rename_mid_turn_survives_the_turns_own_state_write(service):
    """The turn writes a different key afterwards; the rename must stay."""
    sid = await new_session(service)
    turn = await load(service, sid)

    await service.append_event(await load(service, sid), patch_event({"title": "改名"}))
    await service.append_event(turn, turn_event("done", {"lastEventTime": 3.0}))

    assert (await load(service, sid)).state["title"] == "改名"


async def test_two_turns_on_one_session_still_conflict(service):
    sid = await new_session(service)
    first = await load(service, sid)
    second = await load(service, sid)

    await service.append_event(second, turn_event("second turn"))

    with pytest.raises(StaleSessionError):
        await service.append_event(first, turn_event("first turn"))


async def test_patch_writes_user_and_app_state_and_drops_temp(service):
    sid = await new_session(service)
    await service.append_event(
        await load(service, sid),
        patch_event({"user:theme": "dark", "app:flag": True, "temp:scratch": 1}),
    )

    stored = await load(service, sid)
    assert stored.state["user:theme"] == "dark"
    assert stored.state["app:flag"] is True
    assert "temp:scratch" not in stored.state


async def test_patch_on_missing_session_raises(service):
    sid = await new_session(service)
    session = await load(service, sid)
    await service.delete_session(app_name=APP, user_id=USER, session_id=sid)

    with pytest.raises(Exception, match="not found"):
        await service.append_event(session, patch_event({"lastOpenedAt": 1.0}))


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        (patch_event({"k": 1}), True),
        (patch_event({}), True),
        # A turn's event, even one that only carries state.
        (Event(invocation_id="e-1", author="writer"), False),
        (
            Event(
                invocation_id="p-x",
                author="user",
                content=types.Content(role="user", parts=[types.Part(text="hi")]),
            ),
            False,
        ),
        (
            Event(
                invocation_id="p-x",
                author="user",
                actions=EventActions(state_delta={"k": 1}, escalate=True),
            ),
            False,
        ),
        (Event(invocation_id="p-x", author="user", partial=True), False),
    ],
)
def test_is_state_only_write(event, expected):
    assert is_state_only_write(event) is expected


class ToolThenTextModel(BaseLlm):
    """Calls ``open_session_elsewhere`` once, then answers with text."""

    model: str = "fake"

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        called = any(
            part.function_response
            for content in llm_request.contents
            for part in content.parts or []
        )
        part = (
            types.Part(text="查核完成")
            if called
            else types.Part(
                function_call=types.FunctionCall(name="open_session_elsewhere", args={})
            )
        )
        yield LlmResponse(content=types.Content(role="model", parts=[part]))


async def test_real_runner_turn_survives_a_patch_while_its_tool_runs(service):
    """End to end: ADK's Runner loads the session, a tool runs (the window in
    which production's AgentTool calls got PATCHed), the PATCH lands, and the
    turn appends the tool's response and its final answer."""
    sid = await new_session(service)

    async def open_session_elsewhere() -> dict:
        """What the frontend's markSessionOpened does through ADK's PATCH route."""
        elsewhere = await load(service, sid)
        await service.append_event(elsewhere, patch_event({"lastOpenedAt": 9.0}))
        return {"ok": True}

    runner = Runner(
        app_name=APP,
        agent=LlmAgent(
            name="writer",
            model=ToolThenTextModel(),
            instruction="x",
            tools=[FunctionTool(open_session_elsewhere)],
        ),
        session_service=service,
    )

    events = [
        e
        async for e in runner.run_async(
            user_id=USER,
            session_id=sid,
            new_message=types.Content(role="user", parts=[types.Part(text="查")]),
        )
    ]

    final = events[-1].content
    assert final and final.parts and final.parts[0].text == "查核完成"
    stored = await load(service, sid)
    assert stored.state["lastOpenedAt"] == 9.0
    assert stored.events[-1].content.parts[0].text == "查核完成"


async def test_patch_temp_keys_reach_the_caller_but_not_storage(service):
    """Like ADK's append_event: temp: lives in memory for the call only."""
    sid = await new_session(service)
    caller = await load(service, sid)

    await service.append_event(caller, patch_event({"temp:x": 1, "k": 2}))

    assert caller.state["temp:x"] == 1
    assert caller.state["k"] == 2
    assert "temp:x" not in (await load(service, sid)).state


async def test_patch_response_includes_a_turns_newer_state(service):
    """ADK's PATCH handler loads the session, then appends. A turn appending in
    between used to make that PATCH fail; now it succeeds, and the copy it
    returns as the response must not drop the turn's state."""
    sid = await new_session(service)
    handler_copy = await load(service, sid)
    turn = await load(service, sid)
    await service.append_event(turn, turn_event("hi", {"lastEventTime": 5.0}))

    await service.append_event(handler_copy, patch_event({"lastOpenedAt": 6.0}))

    assert handler_copy.state["lastEventTime"] == 5.0
    assert handler_copy.state["lastOpenedAt"] == 6.0


ADK_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture
def fresh_services_module():
    """get_fast_api_app imports adk/services.py as `services`, once per process.
    Drop it and our registrations so each app build loads it again."""
    registry = get_service_registry()
    saved = dict(registry._session_factories)
    sys.modules.pop("services", None)
    yield registry
    sys.modules.pop("services", None)
    registry._session_factories.clear()
    registry._session_factories.update(saved)


async def test_patch_route_through_get_fast_api_app_keeps_the_turn_going(
    db_url, fresh_services_module
):
    """The production wiring end to end: get_fast_api_app (as main.py calls it)
    loads adk/services.py, and ADK's own PATCH route builds the event. Guards
    against ADK changing either the route's event or how services are loaded.
    The turn's copy comes from a plain DatabaseSessionService: the turn only
    survives if the app's PATCH left the stored revision alone."""
    app = get_fast_api_app(
        agents_dir=str(ADK_DIR), session_service_uri=db_url, web=False
    )
    turn_service = DatabaseSessionService(db_url)
    try:
        with TestClient(app) as client:
            sid = str(uuid.uuid4())
            url = f"/apps/{APP}/users/{USER}/sessions/{sid}"
            assert client.post(url, json={"title": "t"}).status_code == 200

            turn = await load(turn_service, sid)
            await turn_service.append_event(turn, turn_event("calling verifier"))

            res = client.patch(url, json={"stateDelta": {"lastOpenedAt": 1.0}})
            assert res.status_code == 200
            assert res.json()["state"]["lastOpenedAt"] == 1.0

            await turn_service.append_event(turn, turn_event("verifier returned"))
    finally:
        await turn_service.close()

    stored = await load(turn_service, sid)
    assert stored.state["lastOpenedAt"] == 1.0
    assert stored.events[-1].content
    assert stored.events[-1].content.parts
    assert stored.events[-1].content.parts[0].text == "verifier returned"


def test_builtin_schemes_are_left_to_adk(tmp_path, fresh_services_module):
    """Only our async URLs get CofactsSessionService; e.g. a plain sqlite://
    URL still gets ADK's SqliteSessionService rather than crashing."""
    register_session_services()

    ours = create_session_service_from_options(
        base_dir=tmp_path,
        session_service_uri=f"sqlite+aiosqlite:///{tmp_path}/a.db",
    )
    adks = create_session_service_from_options(
        base_dir=tmp_path, session_service_uri=f"sqlite:///{tmp_path}/b.db"
    )

    assert type(ours) is CofactsSessionService
    assert type(adks) is SqliteSessionService
