---
status: 'accepted'
date: 2026-11-19
decision-makers: [MrOrz]
consulted:
informed:
---

# Store state-only session writes without bumping ADK's revision marker

## Context and Problem Statement

The frontend writes two pieces of UI metadata into ADK session state through ADK's
`PATCH /apps/{app}/users/{user}/sessions/{id}`: `lastOpenedAt` (every time a session page is
opened or a stream ends) and `title` (rename in the sidebar). We keep them in session state on
purpose: `list_sessions` must return them with every session.

ADK's PATCH route appends a content-less event with an `invocation_id` of `p-<uuid>` carrying
the `state_delta`. `DatabaseSessionService.append_event` stamps every event's time onto
`sessions.update_time`, and since ADK 2.x that column (as a microsecond string) is the revision
marker a running turn compares on each of its own appends. When the PATCH lands while a turn is
in flight, the turn's next append raises `StaleSessionError` and the turn dies. ADK 1.26 instead
reloaded the session silently, so the same writes, present since May 2026, were harmless until
the 1.26 → 2.12 upgrade ([#163](https://github.com/cofacts/ai/pull/163), first released in
`release/20261025`).

Scope: the ADK backend's session service (`adk/cofacts_ai/session_service.py`, wired in
`adk/main.py`). Frontend and BFF are unchanged. Issue:
[cofacts/ai#204](https://github.com/cofacts/ai/issues/204); full investigation in
[its comment](https://github.com/cofacts/ai/issues/204#issuecomment-6955765536).

### Langfuse evidence

All `StaleSessionError`s from 2026-10-01 to 2026-11-18: one in a PR preview (two turns
overlapping on one session) and these four in production. In each, ADK's access log on the GCE
host shows a `PATCH` on the session inside the turn's invocation span, while the writer was
waiting on an `AgentTool` call; the error is raised by the first append after that call returns.

- [S007-T1, 2026-11-09](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/86effacda22188ca91fc3b6c78b7ad7b)
  — `GET session` then `PATCH` at 10:27:33.75 (the session page opened in another tab or after a
  reload), turn died at 10:27:42.98.
- [S020-T1, 2026-11-12](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/63e3134965b01e47c863c82499568126)
  — `PATCH` at 11:27:10.32, turn died at 11:27:17.98.
- [S020-T14, 2026-11-12](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/25d9b45203a788ee6c86a59fc7338642)
  — `PATCH` at 12:33:17.82, turn died at 12:33:20.44.
- [S021-T1, 2026-11-13](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/d00e1e6ec08b4c17c49420b0f2585127)
  — `PATCH` at 00:50:58.38, turn died at 00:51:20.99.

In the last three, the requests around the PATCH (session list, PATCH, session list) match what
the page sends when its own stream ends, which suggests the user pressed Stop. ADK hadn't
noticed the disconnect yet because nothing was being streamed during the sub-agent call.

## Decision Drivers

- A metadata write must never end a turn, whatever triggers it: another tab, a reload, Stop, or
  a rename. It must also work without Redis and without changes to the frontend.
- `list_sessions` keeps returning `title` and `lastOpenedAt` in each session's state.
- Two turns writing to one session at once must still be rejected. Silently interleaving their
  events would corrupt the history each agent sees.
- Keep the copy of ADK internals small, and fail a test when an ADK upgrade moves them.

## Considered Options

1. Defer or refuse metadata writes while a turn holds the session (what
   [#197](https://github.com/cofacts/ai/pull/197) does with its Redis lock).
2. Move UI metadata out of ADK into our own table or Redis, merged in by the BFF.
3. Write `sessions.state` directly with SQL from our own endpoint (no event, no `update_time`).
4. `user:`-prefixed state, written through a dedicated `_meta` session per user.
5. On `StaleSessionError`, reload; if every new event is a state-only `p-` event, merge it and
   retry.
6. Disable the stale check (always sync the in-memory marker), or adjust `last_update_time`.
7. Override all of `DatabaseSessionService.append_event`.
8. Override `append_event` only for state-only `p-` events: lock, merge the state and store the
   event like ADK does, but leave `update_time` alone. All other events go to ADK unchanged.

## Decision Outcome

Chosen option: 8, `CofactsSessionService`, because it removes the cause rather than reacting to
it. No running turn ever sees a new revision from a metadata write, so there is nothing to
retry, gate or race. The turn-writing path stays ADK's own code, stale check included.

How it works:

- `is_state_only_write(event)`: `invocation_id` starts with `p-`, the event is not partial, has
  no `content`, and has no action besides `state_delta`. This is exactly what ADK's PATCH route
  builds.
- For such an event, `_append_state_only_event` takes the same per-session lock as ADK's
  `append_event` (the in-process lock, plus `SELECT … FOR UPDATE` on Postgres). It then merges
  the app, user and session deltas (temp keys trimmed), stores the event, and commits without
  touching `update_time`.
- A turn's later appends re-select the session row and merge their own delta into the stored
  state, so both sides' keys survive.
- `register_session_service(DATABASE_URL)` registers our factory for the URL's scheme. ADK
  matches factories by exact scheme, and `postgresql+asyncpg` / `sqlite+aiosqlite` are not
  registered, so without this ADK falls back to a plain `DatabaseSessionService`. The call sits
  before `get_fast_api_app()` in `main.py`.

### Consequences

- Good, because the four production failures above can no longer happen, with or without
  #197's Redis lock.
- Good, because opening or renaming a session no longer moves `lastUpdateTime`. The
  `lastEventTime` workaround the sidebar sorts by could be retired in a follow-up.
- Good, because `p-` events are still stored, so the history records every state change as
  before.
- Good, because a second turn writing to the same session still gets `StaleSessionError`.
- Bad, because `_append_state_only_event` reuses ADK internals: `_with_session_lock`,
  `_rollback_on_exception_session`, `_get_schema_classes`, `_supports_row_level_locking`,
  `_trim_temp_delta_state`, `_commit_event_to_session`, `_select_required_state` and
  `_session_util.extract_json_safe_state_delta`.
- Bad, because a state-only write is recognised by convention (the `p-` prefix ADK's PATCH
  route uses). Anything else that appends `p-` events with only a `state_delta` takes this path
  too.
- Neutral, because a running turn's in-memory state doesn't see the PATCHed values. Neither key
  is read by an agent. If a turn writes the same key later, the turn wins: e.g. the first turn's
  generated `title` would replace a rename made during that turn. The sidebar already hides
  rename while the turn streams in that tab.
- Neutral, because `update_time` can now be older than the newest event. ADK uses it only as
  the marker and for list ordering. Its marker-less fallback, which compares the newest event
  id, applies only to sessions not loaded by `DatabaseSessionService`, which we don't have.

## Confirmation

`adk/cofacts_ai/tests/test_session_service.py` runs on SQLite, and on PostgreSQL when
`TEST_POSTGRES_URL` is set (checked locally against a `postgres:15` container). It covers:

- `test_plain_adk_service_kills_the_turn`: plain ADK still raises. If an upgrade makes this
  fail, revisit whether the override is still needed.
- A PATCH between two appends of a turn: the turn continues, `update_time` is unchanged, and
  both keys are stored.
- A real `Runner` turn whose tool triggers a PATCH: it finishes with its final answer.
- Two turns on one session still conflict.
- `user:`, `app:` and `temp:` handling, a missing session, and the event predicate.
- `get_fast_api_app`'s service factory returns `CofactsSessionService` for `sqlite+aiosqlite`
  and `postgresql+asyncpg` URLs.

On each ADK upgrade, diff `DatabaseSessionService.append_event` against
`_append_state_only_event`.

## Pros and Cons of the Options

### 1. Defer or refuse metadata writes while a turn holds the session

- Good, because it uses no ADK internals.
- Bad, because the lock check and the write are separate steps. A turn starting between them
  still dies, and a rename checked in the BFF has a whole HTTP round trip in between.
- Bad, because it needs Redis. Without `REDIS_URL` there is no protection at all.
- Bad, because it only covers callers that know to check. ADK's own PATCH route stays open.

### 2. Keep UI metadata outside ADK

- Good, because it's the cleanest separation and needs no ADK internals.
- Bad, because every session list becomes two lookups to merge. Deleting a session has to clean
  up both stores. And `title` is also written by an agent callback (`generate_session_title`),
  which would need a second write path.

### 3. Write `sessions.state` directly with SQL

- Good, because it's a single atomic `state || patch` that a turn's `FOR UPDATE` queues behind,
  and it leaves `update_time` alone.
- Bad, because it depends on ADK's table layout (JSONB `state`, `update_time` as the marker), is
  reachable only through our own endpoint, and leaves no event in the history. The
  [ADK state docs](https://adk.dev/sessions/state/index.md) explicitly discourage changing state
  outside `append_event`.

### 4. `user:` state through a `_meta` session

- Good, because the write goes through ADK's own `append_event` (to the `_meta` session), and
  a running session's marker is untouched.
- Bad, because `list_sessions` merges the whole user state into every session. Per-session
  metadata keyed by session id grows quadratically in the list response. It also shows up in
  every agent's state, and the `_meta` session must be filtered out of the list.

### 5. Reload and retry when only `p-` events intervened

- Good, because it uses only one private attribute (`_storage_update_marker`) and works for any
  caller.
- Bad, because it reacts after the fact: a full session reload on each conflict, a retry loop
  in case another PATCH lands meanwhile, and `p-` events are spliced into the turn's in-memory
  history.

### 6. Disable the stale check, or adjust `last_update_time`

- Bad, because adjusting `last_update_time` does nothing. Sessions loaded from the database
  carry a marker, and the check compares only the marker. The marker-less fallback compares the
  newest event id, which a PATCH also changes.
- Bad, because always syncing the marker also lets two concurrent turns interleave their events
  silently. ADK 1.26 reloaded rather than ignored for that reason.

### 7. Override all of `append_event`

- Good, because it gives full control in one transaction.
- Bad, because it forks about 120 lines of ADK's core write path (stale check, temp state, three
  state tables, event storage). That function changed substantially between 1.26 and 2.12, and
  the turn path is where a drift would silently corrupt conversation history.

### 8. Override `append_event` for state-only events only (chosen)

- Good, because no turn sees a revision change from metadata, with no retries or gating.
- Good, because ADK's PATCH route, #197's `/opened`, and anything else using the session service
  get it with no caller changes.
- Good, because the turn path stays entirely ADK's.
- Bad, because the state-only path reuses ADK internals (see Consequences); tests guard them.

## More Information

- Issue: [cofacts/ai#204](https://github.com/cofacts/ai/issues/204). Background-runs PR:
  [cofacts/ai#197](https://github.com/cofacts/ai/pull/197). With this in place, #197's `/opened`
  deferral and its rename refusal are no longer needed to protect a turn.
- ADK references (2.12.0): `DatabaseSessionService.append_event`
  (`google/adk/sessions/database_session_service.py`), the PATCH route `update_session`
  (`google/adk/cli/api_server.py`), the marker `StorageSession.get_update_marker`
  (`google/adk/sessions/schemas/v1.py`).
- Revisit if ADK adds session-level metadata, a state-only update API, or changes what the
  revision marker covers.
