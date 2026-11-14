"""Background runs that outlive the HTTP request that started them.

ADK's own ``/run_sse`` ties a run to its HTTP connection: when the browser goes
away the run is cancelled (google/adk-python#4029). This module splits
*executing* a run from *watching* it:

- ``start()`` takes a per-session lock in Redis and drains
  ``runner.run_async()`` in an ``asyncio`` task that no request owns (the
  "drain task"). The process holding that task is the run's *owner*.
- Every event the run yields, partial or not, is appended to a Redis Stream.
  Any number of viewers, in any process, read that stream with
  ``stream()``: first everything this run has written so far, then
  ``XREAD BLOCK`` for the rest. A viewer that disconnects only stops
  watching.
- ``cancel()`` stops a run explicitly. Owners also stop their runs on
  SIGTERM and when a run goes past ``RUN_TIMEOUT_SECONDS``.

Redis holds only the run in progress. Once it ends, everything is in the
ADK session (Postgres), and viewers fall back to the session history.

Redis keys (all prefixed and all expiring, since the production Redis is
shared with rumors-line-bot and has no ``maxmemory``):

- ``cofacts-ai:run:{user}:{sid}`` -- the lock. JSON ``{runId, owner,
  invocationId}``. ``SET NX PX 30000``, renewed every 10s by the owner.
- ``cofacts-ai:stream:{user}:{sid}`` -- the stream. Each entry is
  ``{runId, type, partial, data}``; ``type`` is ``event`` or ``done``.
- ``cofacts-ai:cancel:{user}:{sid}`` -- a cancel request for the run whose
  ``runId`` it holds, for when the cancel lands on a process that isn't the
  owner.

See docs/decisions/20261114-background-runs-redis-streams.md for the design.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
import uuid
from contextlib import aclosing
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, cast

import pydantic_core
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.auth.auth_credential import _redact_credential_secrets
from google.adk.events._internal_metadata import public_event
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.runners import Runner
from google.adk.sessions.base_session_service import BaseSessionService
from google.genai import types
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

KEY_PREFIX = "cofacts-ai"

LOCK_TTL_MS = 30_000
LOCK_RENEW_SECONDS = 10.0
# While a run is going, its stream outlives a dead owner by this long.
STREAM_TTL_SECONDS = 60
# After a run ends, viewers still behind on the stream get this long to read
# the last entries and the done marker. Past that they hit the lock check
# instead and refetch the history, which has everything by then.
STREAM_TTL_AFTER_DONE_SECONDS = 30
STREAM_MAXLEN = 20_000
CANCEL_TTL_SECONDS = 600
CANCEL_POLL_SECONDS = 1.0
WRITE_BATCH_SECONDS = 0.05
# A viewer waits this long on XREAD before sending a heartbeat and checking
# that the run is still alive. Below Cloudflare's 125s idle cut-off.
STREAM_BLOCK_MS = 20_000
# How long start() waits for the run's first event (the stored user message)
# to learn its invocation id.
FIRST_EVENT_TIMEOUT_SECONDS = 30.0
# After an abort, how long the drain task gets to end by itself before it is
# cancelled outright.
ABORT_GRACE_SECONDS = 8.0

# Every run that does not end normally gets one last event carrying this
# customMetadata key, so a client loading the history later can tell how the
# turn ended. "cancelled": the user pressed stop. "interrupted": the system
# stopped it (redeploy, time limit, error); the client offers to ask again.
RUN_END_METADATA_KEY = "cofacts_run_end"
RunEnd = Literal["cancelled", "interrupted"]

SESSION_LAST_EVENT_TIME_KEY = "lastEventTime"
SESSION_LAST_OPENED_KEY = "lastOpenedAt"

HEARTBEAT = b": heartbeat\n\n"


def run_timeout_seconds() -> float:
    """Longest a run may go on, matching Cloud Run's 900s request timeout."""
    return float(os.environ.get("RUN_TIMEOUT_SECONDS", "900"))


def lock_key(user_id: str, session_id: str) -> str:
    return f"{KEY_PREFIX}:run:{user_id}:{session_id}"


def stream_key(user_id: str, session_id: str) -> str:
    return f"{KEY_PREFIX}:stream:{user_id}:{session_id}"


def cancel_key(user_id: str, session_id: str) -> str:
    return f"{KEY_PREFIX}:cancel:{user_id}:{session_id}"


# Renews the lock only while it is still ours. If it is gone (Redis restarted,
# or we were too slow), takes it back as long as nobody else has it.
_RENEW_LOCK = """
local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
elseif not v then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 2
end
return 0
"""

# Deletes the lock only while it is still ours.
_RELEASE_LOCK = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


def serialize_event(event: Event) -> list[str]:
    """Turns one ADK event into the JSON that ADK's /run_sse would send.

    Mirrors ``run_agent_sse`` in google/adk/cli/api_server.py, including
    splitting an event that carries both content and an artifact delta in
    two, so clients see exactly the same frames as before.
    """
    events = [event]
    if event.actions.artifact_delta and event.content and event.content.parts:
        content_event = event.model_copy(deep=True)
        content_event.actions.artifact_delta = {}
        artifact_event = event.model_copy(deep=True)
        artifact_event.content = None
        events = [content_event, artifact_event]
    return [
        pydantic_core.to_json(
            _redact_credential_secrets(
                public_event(e).model_dump(
                    exclude_none=True, by_alias=True, mode="json"
                )
            )
        ).decode("utf-8")
        for e in events
    ]


def sse_frame(data: str) -> bytes:
    return f"data: {data}\n\n".encode()


@dataclass
class _Entry:
    id: str
    run_id: str
    type: str
    partial: bool
    data: str


def _decode(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


def _entry(entry_id: Any, fields: dict[Any, Any]) -> _Entry:
    f = {_decode(k): _decode(v) for k, v in fields.items()}
    return _Entry(
        id=_decode(entry_id),
        run_id=f.get("runId", ""),
        type=f.get("type", "event"),
        partial=f.get("partial") == "1",
        data=f.get("data", ""),
    )


def compact_backlog(entries: list[_Entry]) -> list[_Entry]:
    """Drops partial entries that a later complete event already covers.

    The client appends a partial to the message still streaming, and a
    complete event either finishes that message or starts a new one with its
    full text. So partials only matter after the last complete event: they
    are the message still being typed.
    """
    last_complete = max((i for i, e in enumerate(entries) if not e.partial), default=-1)
    return [e for i, e in enumerate(entries) if not e.partial or i > last_complete]


class _PendingText:
    """The text a run has streamed since its last complete event.

    Partial events are never stored, so when a run is stopped this is the
    only record of the words already on the viewers' screens.
    """

    def __init__(self) -> None:
        self.author: str | None = None
        self.text = ""

    def track(self, event: Event) -> None:
        if not event.partial:
            # A complete model message replaces the partials before it. Other
            # complete events (tool results, ADK's INVOCATION_ABORTED marker)
            # leave the text on screen as it is.
            if event.content and event.content.role == "model":
                self.author, self.text = None, ""
            return
        if event.author != self.author:
            self.author, self.text = event.author, ""
        for part in (event.content.parts if event.content else None) or []:
            if part.text and not part.thought:
                self.text += part.text


class _StreamWriter:
    """Appends entries to the run's stream in batches.

    Viewers on Cloud Run reach Redis Cloud over the internet; awaiting each
    of a turn's thousand-odd partials one round trip at a time would slow the
    run itself down. Entries go into a buffer and a task writes whatever has
    piled up every WRITE_BATCH_SECONDS in one pipeline.
    """

    def __init__(self, redis: Redis, key: str, run_id: str) -> None:
        self._redis = redis
        self._key = key
        self._run_id = run_id
        self._buf: list[dict[Any, Any]] = []
        self._wake = asyncio.Event()
        self._closing = False
        self._task = asyncio.create_task(self._loop())

    def put(self, data: str, *, partial: bool) -> None:
        self._buf.append(
            {
                "runId": self._run_id,
                "type": "event",
                "partial": "1" if partial else "0",
                "data": data,
            }
        )
        self._wake.set()

    async def _loop(self) -> None:
        while True:
            await self._wake.wait()
            if not self._closing:
                await asyncio.sleep(WRITE_BATCH_SECONDS)
            batch, self._buf = self._buf, []
            self._wake.clear()
            if batch:
                try:
                    pipe = self._redis.pipeline(transaction=False)
                    for fields in batch:
                        pipe.xadd(
                            self._key, fields, maxlen=STREAM_MAXLEN, approximate=True
                        )
                    pipe.expire(self._key, STREAM_TTL_SECONDS)
                    await pipe.execute()
                except Exception:
                    # Viewers miss these entries and catch up from the
                    # session history; the run itself goes on.
                    logger.exception(
                        "Writing %d entries to %s failed", len(batch), self._key
                    )
            if self._closing and not self._buf:
                return

    async def close(self) -> None:
        """Writes out whatever is still buffered, then stops."""
        self._closing = True
        self._wake.set()
        await self._task


@dataclass
class _Run:
    run_id: str
    user_id: str
    session_id: str
    lock_value: str
    abort: asyncio.Event = field(default_factory=asyncio.Event)
    end: RunEnd | None = None
    invocation_id: asyncio.Future[str] = field(
        default_factory=lambda: asyncio.get_running_loop().create_future()
    )
    pending: _PendingText = field(default_factory=_PendingText)
    task: asyncio.Task[None] | None = None

    def stop(self, end: RunEnd) -> None:
        """Asks ADK to abort the run; cancels the task if that doesn't end it."""
        if self.end is None:
            self.end = end
        if self.abort.is_set():
            return
        self.abort.set()
        task = self.task
        if task is not None:
            asyncio.get_running_loop().call_later(
                ABORT_GRACE_SECONDS, lambda: task.done() or task.cancel()
            )


@dataclass
class StartResult:
    started: bool
    invocation_id: str | None


class RunBusUnavailable(Exception):
    """Raised when this process refuses new runs (shutting down)."""


class RunBus:
    def __init__(
        self,
        *,
        redis: Redis,
        app_name: str,
        get_runner: Callable[[], Any],
        session_service: BaseSessionService,
        owner_id: str | None = None,
    ) -> None:
        self.redis = redis
        self.app_name = app_name
        self._get_runner = get_runner
        self.session_service = session_service
        self.owner_id = (
            owner_id or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        )
        self._runs: dict[tuple[str, str], _Run] = {}
        self._closing = False
        self._root_agent = "writer"

    # ---- lock -----------------------------------------------------------

    async def read_lock(self, user_id: str, session_id: str) -> dict[str, Any] | None:
        raw = await self.redis.get(lock_key(user_id, session_id))
        if raw is None:
            return None
        try:
            return json.loads(_decode(raw))
        except ValueError:
            return None

    async def _lock_held(self, user_id: str, session_id: str, run_id: str) -> bool:
        lock = await self.read_lock(user_id, session_id)
        return lock is not None and lock.get("runId") == run_id

    # ---- start ----------------------------------------------------------

    async def start(
        self,
        *,
        user_id: str,
        session_id: str,
        new_message: types.Content,
    ) -> StartResult:
        """Starts a run in the background, unless the session already has one.

        Returns once the run has stored the user's message, so the caller
        gets the invocation id. When another run holds the session, returns
        ``started=False`` with that run's invocation id (if known yet).
        """
        if self._closing:
            raise RunBusUnavailable("shutting down")

        run_id = uuid.uuid4().hex
        lock_value = json.dumps({"runId": run_id, "owner": self.owner_id})
        acquired = await self.redis.set(
            lock_key(user_id, session_id), lock_value, nx=True, px=LOCK_TTL_MS
        )
        if not acquired:
            lock = await self.read_lock(user_id, session_id)
            return StartResult(False, (lock or {}).get("invocationId"))

        # The stream key is per session; drop whatever a previous run left.
        await self.redis.delete(stream_key(user_id, session_id))

        run = _Run(
            run_id=run_id, user_id=user_id, session_id=session_id, lock_value=lock_value
        )
        self._runs[(user_id, session_id)] = run
        # create_task copies the current context, so the run keeps this
        # request's Cofacts token (cofacts_token_var) after the request ends.
        run.task = asyncio.create_task(self._drain(run, new_message))

        try:
            invocation_id = await asyncio.wait_for(
                asyncio.shield(run.invocation_id), FIRST_EVENT_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            invocation_id = None
        # Any other exception: the run failed before storing the message
        # (e.g. no such session) and has already cleaned up after itself.
        return StartResult(True, invocation_id or None)

    # ---- drain task -----------------------------------------------------

    async def _drain(self, run: _Run, new_message: types.Content) -> None:
        user_id, session_id = run.user_id, run.session_id
        writer = _StreamWriter(self.redis, stream_key(user_id, session_id), run.run_id)
        keeper = asyncio.create_task(self._keep_alive(run))
        timer = asyncio.get_running_loop().call_later(
            run_timeout_seconds(), run.stop, "interrupted"
        )
        try:
            runner: Runner = await self._get_runner()
            self._root_agent = runner.agent.name
            async with aclosing(
                runner.run_async(
                    user_id=user_id,
                    session_id=session_id,
                    new_message=new_message,
                    run_config=RunConfig(streaming_mode=StreamingMode.SSE),
                    yield_user_message=True,
                    abort_signal=run.abort,
                )
            ) as agen:
                async for event in agen:
                    if not run.invocation_id.done() and event.invocation_id:
                        run.invocation_id.set_result(event.invocation_id)
                        await self._record_invocation_id(run, event.invocation_id)
                    run.pending.track(event)
                    for data in serialize_event(event):
                        writer.put(data, partial=bool(event.partial))
        except asyncio.CancelledError:
            # Cancelled outright: an abort that didn't end the run in time.
            # Seal it below and end quietly.
            if run.end is None:
                run.end = "interrupted"
        except Exception as e:
            logger.exception("Run %s for session %s failed", run.run_id, session_id)
            if not run.invocation_id.done():
                run.invocation_id.set_exception(e)
                # Retrieved by start(); keep asyncio from warning if it timed out.
                run.invocation_id.exception()
            elif run.end is None:
                run.end = "interrupted"
        finally:
            timer.cancel()
            keeper.cancel()
            if not run.invocation_id.done():
                run.invocation_id.set_result("")  # ended without any event
            try:
                await self._finish(run, writer)
            finally:
                if self._runs.get((user_id, session_id)) is run:
                    del self._runs[(user_id, session_id)]

    async def _finish(self, run: _Run, writer: _StreamWriter) -> None:
        """Seals the run: last event, done marker, lock released.

        Runs to completion even if the task is being cancelled, since a run
        left without its done marker or lock release leaves viewers waiting.
        """

        async def seal() -> None:
            if (
                run.end is not None
                and run.invocation_id.done()
                and not run.invocation_id.exception()
                and run.invocation_id.result()
            ):
                try:
                    event = await self._append_run_end(run)
                    for data in serialize_event(event):
                        writer.put(data, partial=False)
                except Exception:
                    logger.exception("Recording the end of run %s failed", run.run_id)
            await writer.close()
            key = stream_key(run.user_id, run.session_id)
            try:
                await self.redis.xadd(
                    key,
                    {
                        "runId": run.run_id,
                        "type": "done",
                        "partial": "0",
                        "data": run.end or "completed",
                    },
                    maxlen=STREAM_MAXLEN,
                    approximate=True,
                )
                await self.redis.expire(key, STREAM_TTL_AFTER_DONE_SECONDS)
                await self.redis.eval(  # type: ignore[misc]
                    _RELEASE_LOCK,
                    1,
                    lock_key(run.user_id, run.session_id),
                    run.lock_value,
                )
                await self.redis.delete(cancel_key(run.user_id, run.session_id))
            except Exception:
                logger.exception("Releasing run %s failed", run.run_id)

        task = asyncio.ensure_future(seal())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

    async def _append_run_end(self, run: _Run) -> Event:
        """Stores what the viewers saw being typed, marked with how it ended."""
        session = await self.session_service.get_session(
            app_name=self.app_name, user_id=run.user_id, session_id=run.session_id
        )
        if session is None:
            raise RuntimeError(f"session {run.session_id} is gone")
        text = run.pending.text
        event = Event(
            invocation_id=run.invocation_id.result(),
            author=run.pending.author or self._root_agent,
            content=types.Content(role="model", parts=[types.Part(text=text)])
            if text
            else None,
            custom_metadata={RUN_END_METADATA_KEY: run.end},
            # after_agent_callback did not get to run; keep the sidebar's
            # sort order and unread dot right anyway.
            actions=EventActions(
                state_delta={SESSION_LAST_EVENT_TIME_KEY: time.time()}
            ),
        )
        await self.session_service.append_event(session=session, event=event)
        return event

    async def _record_invocation_id(self, run: _Run, invocation_id: str) -> None:
        value = json.dumps(
            {"runId": run.run_id, "owner": self.owner_id, "invocationId": invocation_id}
        )
        try:
            ok = await self.redis.set(
                lock_key(run.user_id, run.session_id), value, xx=True, px=LOCK_TTL_MS
            )
            if ok:
                run.lock_value = value
        except Exception:
            logger.exception("Recording invocation id for run %s failed", run.run_id)

    async def _keep_alive(self, run: _Run) -> None:
        """Renews the lock and the stream's TTL, and watches for cancel requests."""
        ticks_per_renew = max(1, round(LOCK_RENEW_SECONDS / CANCEL_POLL_SECONDS))
        tick = 0
        while True:
            await asyncio.sleep(CANCEL_POLL_SECONDS)
            tick += 1
            try:
                requested = await self.redis.get(
                    cancel_key(run.user_id, run.session_id)
                )
                if requested is not None and _decode(requested) == run.run_id:
                    run.stop("cancelled")
                if tick % ticks_per_renew == 0:
                    await self.redis.eval(  # type: ignore[misc]
                        _RENEW_LOCK,
                        1,
                        lock_key(run.user_id, run.session_id),
                        run.lock_value,
                        str(LOCK_TTL_MS),
                    )
                    await self.redis.expire(
                        stream_key(run.user_id, run.session_id), STREAM_TTL_SECONDS
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Keeping run %s alive failed", run.run_id)

    # ---- viewers --------------------------------------------------------

    async def status(self, user_id: str, session_id: str) -> dict[str, Any]:
        lock = await self.read_lock(user_id, session_id)
        if lock is None:
            return {"running": False, "invocationId": None}
        return {"running": True, "invocationId": lock.get("invocationId")}

    async def stream(self, user_id: str, session_id: str) -> AsyncIterator[bytes]:
        """SSE bytes for the run in progress, from its first event on.

        Ends (the connection closes) when the run ends, or right away when
        there is no run.
        """
        lock = await self.read_lock(user_id, session_id)
        if lock is None:
            return
        run_id = str(lock.get("runId"))
        key = stream_key(user_id, session_id)

        raw = cast(list[tuple[Any, dict[Any, Any]]], await self.redis.xrange(key))
        entries = [_entry(i, f) for i, f in raw]
        mine = [e for e in entries if e.run_id == run_id]
        if any(e.type == "done" for e in mine):
            return  # just ended; the history has it all
        backlog = [sse_frame(e.data) for e in compact_backlog(mine)]
        if backlog:
            yield b"".join(backlog)
        last = entries[-1].id if entries else "0-0"

        while True:
            res = cast(
                list[tuple[Any, list[tuple[Any, dict[Any, Any]]]]],
                await self.redis.xread({key: last}, block=STREAM_BLOCK_MS),
            )
            if not res:
                if not await self._lock_held(user_id, session_id, run_id):
                    return  # owner died, or we fell too far behind to see done
                yield HEARTBEAT
                continue
            for _key, items in res:
                for entry_id, fields in items:
                    e = _entry(entry_id, fields)
                    last = e.id
                    if e.run_id != run_id:
                        continue
                    if e.type == "done":
                        return
                    yield sse_frame(e.data)

    async def cancel(self, user_id: str, session_id: str) -> bool:
        """Stops the session's run. Returns False when there is none."""
        run = self._runs.get((user_id, session_id))
        if run is not None:
            run.stop("cancelled")
            return True
        lock = await self.read_lock(user_id, session_id)
        if lock is None:
            return False
        # Another process owns it; it checks this key every second.
        await self.redis.set(
            cancel_key(user_id, session_id), lock["runId"], ex=CANCEL_TTL_SECONDS
        )
        return True

    async def mark_opened(self, user_id: str, session_id: str) -> bool:
        """Records that the user opened the session, unless a run is going.

        Any write to the session while a run is going makes the run's next
        write fail with StaleSessionError, killing it. Returns True when the
        write was deferred; the client calls again once the run ends.
        """
        if await self.read_lock(user_id, session_id) is not None:
            return True
        await append_state_delta(
            self.session_service,
            app_name=self.app_name,
            user_id=user_id,
            session_id=session_id,
            state_delta={SESSION_LAST_OPENED_KEY: time.time()},
        )
        return False

    # ---- shutdown -------------------------------------------------------

    async def shutdown(self) -> None:
        """Stops every run this process owns, for a redeploy or scale-in.

        Waiting for runs to finish would take minutes; each run is instead
        sealed as interrupted so its viewers can offer to ask again.
        """
        self._closing = True
        runs = list(self._runs.values())
        if not runs:
            return
        logger.info("Shutting down: interrupting %d run(s)", len(runs))
        for run in runs:
            run.stop("interrupted")
        tasks = [r.task for r in runs if r.task is not None]
        # stop() cancels whatever hasn't ended after ABORT_GRACE_SECONDS.
        await asyncio.wait(tasks, timeout=ABORT_GRACE_SECONDS + 2)

    def running_count(self) -> int:
        return len(self._runs)


async def append_state_delta(
    session_service: BaseSessionService,
    *,
    app_name: str,
    user_id: str,
    session_id: str,
    state_delta: dict[str, Any],
) -> None:
    """What ADK's PATCH /sessions/{id} does: a state-only event."""
    session = await session_service.get_session(
        app_name=app_name, user_id=user_id, session_id=session_id
    )
    if session is None:
        raise LookupError(session_id)
    await session_service.append_event(
        session=session,
        event=Event(
            invocation_id="p-" + str(uuid.uuid4()),
            author="user",
            actions=EventActions(state_delta=state_delta),
        ),
    )
