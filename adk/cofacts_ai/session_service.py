"""A DatabaseSessionService whose state-only writes don't kill a running turn.

ADK's ``PATCH /sessions/{id}`` (the frontend's ``lastOpenedAt`` and session
rename) stores its state change as a content-less event with an ``p-``
invocation id. ``DatabaseSessionService.append_event`` stamps every event's
time onto ``sessions.update_time``, and that column is the revision marker a
running turn compares against on each of its own appends. So a PATCH that lands
while a turn is waiting on a sub-agent makes the turn's next append raise
``StaleSessionError`` and the turn dies (cofacts/ai#204).

Here those state-only events take their own path: the state is merged and the
event is stored, under the same per-session locks, but ``update_time`` is left
alone. A turn's marker stays valid, so it carries on; its later appends re-read
the stored state and merge their own delta into it, so neither side loses a
key. Every other event, including two turns writing to one session at once,
still goes through ADK's ``append_event`` and its stale check unchanged.

``adk/services.py`` registers this class with ADK, so ``get_fast_api_app``
(``main.py``, ``adk web``, ``adk api_server``) uses it for a ``DATABASE_URL``
of ``postgresql+asyncpg`` or ``sqlite+aiosqlite``. With ``DATABASE_URL`` unset,
ADK picks its own ``SqliteSessionService``, which keeps the stale check.

Decision record: docs/decisions/20261119-state-only-writes-skip-revision.md
"""

from __future__ import annotations

from typing import Any

from google.adk.cli.service_registry import get_service_registry
from google.adk.errors.session_not_found_error import SessionNotFoundError
from google.adk.events.event import Event
from google.adk.sessions import _session_util
from google.adk.sessions.database_session_service import (
    DatabaseSessionService,
    _merge_state,
    _select_required_state,
)
from google.adk.sessions.session import Session
from google.adk.sessions.state import State
from sqlalchemy import select
from typing_extensions import override

# ADK's PATCH route builds the event as Event(invocation_id="p-" + uuid4(), ...).
STATE_ONLY_INVOCATION_PREFIX = "p-"

# The DATABASE_URL schemes we deploy with (production/preview: asyncpg; the
# backend image's default and local Docker: aiosqlite). ADK registers neither,
# and its built-in schemes (sqlite, memory, postgresql, ...) are left as they are.
DATABASE_URL_SCHEMES = ("postgresql+asyncpg", "sqlite+aiosqlite")


def is_state_only_write(event: Event) -> bool:
    """Whether ``event`` is a session-state write made outside any turn.

    Matches what ADK's PATCH route appends: an ``p-`` invocation, no content,
    and no action besides ``state_delta``. Anything else is left to ADK.
    """
    if not event.invocation_id.startswith(STATE_ONLY_INVOCATION_PREFIX):
        return False
    if event.partial or event.content is not None:
        return False
    # exclude_none too: agent_state dumps as an explicit None even when unset.
    actions = event.actions.model_dump(exclude_defaults=True, exclude_none=True)
    return set(actions) <= {"state_delta"}


class CofactsSessionService(DatabaseSessionService):
    """DatabaseSessionService that stores state-only writes without a new revision."""

    @override
    async def append_event(self, session: Session, event: Event) -> Event:
        if is_state_only_write(event):
            return await self._append_state_only_event(session, event)
        return await super().append_event(session, event)

    async def _append_state_only_event(self, session: Session, event: Event) -> Event:
        """Stores ``event`` and merges its state, leaving ``update_time`` as is.

        Mirrors the storage half of ``DatabaseSessionService.append_event``
        minus its two revision steps: no stale check (this write doesn't build
        on the history, only on the stored state it locks and merges into) and
        no ``update_time`` stamp (so no running turn sees a new revision).

        Since there's no stale check, ``session`` may be older than storage (a
        turn appended after the caller loaded it). Its state is refreshed from
        the locked rows, so ADK's PATCH response shows the current state; its
        events are not reloaded.
        """
        await self.prepare_tables()
        self._apply_temp_state(session, event)
        event = self._trim_temp_delta_state(event)
        deltas = _session_util.extract_json_safe_state_delta(event.actions.state_delta)

        schema = self._get_schema_classes()
        lock_rows = self._supports_row_level_locking()

        async with self._with_session_lock(
            app_name=session.app_name,
            user_id=session.user_id,
            session_id=session.id,
        ):
            async with self._rollback_on_exception_session() as sql_session:
                # Lock the session row even when only app/user state changes,
                # so this write queues behind a turn's append the same way.
                stmt = (
                    select(schema.StorageSession)
                    .filter(schema.StorageSession.app_name == session.app_name)
                    .filter(schema.StorageSession.user_id == session.user_id)
                    .filter(schema.StorageSession.id == session.id)
                )
                if lock_rows:
                    stmt = stmt.with_for_update()
                storage_session: Any = (
                    (await sql_session.execute(stmt)).scalars().one_or_none()
                )
                if storage_session is None:
                    raise SessionNotFoundError(f"Session {session.id} not found.")

                app_state = await _select_required_state(
                    sql_session=sql_session,
                    state_model=schema.StorageAppState,
                    predicates=(schema.StorageAppState.app_name == session.app_name,),
                    use_row_level_locking=lock_rows and bool(deltas["app"]),
                    missing_message=f"App state missing for {session.app_name!r}.",
                )
                user_state = await _select_required_state(
                    sql_session=sql_session,
                    state_model=schema.StorageUserState,
                    predicates=(
                        schema.StorageUserState.app_name == session.app_name,
                        schema.StorageUserState.user_id == session.user_id,
                    ),
                    use_row_level_locking=lock_rows and bool(deltas["user"]),
                    missing_message=(
                        f"User state missing for {session.app_name!r}, "
                        f"{session.user_id!r}."
                    ),
                )
                if deltas["app"]:
                    app_state.state.update(deltas["app"])
                if deltas["user"]:
                    user_state.state.update(deltas["user"])
                if deltas["session"]:
                    storage_session.state.update(deltas["session"])

                stored_state = _merge_state(
                    app_state.state, user_state.state, storage_session.state
                )
                sql_session.add(schema.StorageEvent.from_event(session, event))
                await sql_session.commit()

        # Keep the invocation-scoped temp keys, which storage never holds.
        temp_state = {
            k: v for k, v in session.state.items() if k.startswith(State.TEMP_PREFIX)
        }
        session.state = {**stored_state, **temp_state}
        session.events.append(event)
        return event


def register_session_services() -> None:
    """Makes ADK build ``CofactsSessionService`` for our ``DATABASE_URL`` schemes.

    ADK looks factories up by the URL's exact scheme and would otherwise fall
    back to a plain ``DatabaseSessionService`` for these. Called from
    ``adk/services.py``, which ``get_fast_api_app`` imports.
    """

    def factory(uri: str, **kwargs: Any) -> CofactsSessionService:
        kwargs.pop("agents_dir", None)
        return CofactsSessionService(db_url=uri, **kwargs)

    registry = get_service_registry()
    for scheme in DATABASE_URL_SCHEMES:
        registry.register_session_service(scheme, factory)
