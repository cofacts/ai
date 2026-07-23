---
status: 'accepted'
date: 2026-06-03
decision-makers: [MrOrz]
consulted:
informed:
---

# Propagate the auth token to ADK tools via header + ContextVar

## Context and Problem Statement

The BFF relays the user's long-lived Cofacts JWT to the ADK backend so that ADK
tools (`adk/cofacts_ai/tools.py`) can call `rumors-api` GraphQL on the user's behalf.
The question this decision settles is purely inside the ADK backend: how a per-request
token, once received over HTTP, is carried down to the tool functions that run deep
inside `runner.run_async`.

The original approach in `run-sse.ts` sent the token as
`stateDelta: { 'temp:cofacts_token': token }` and had tools read
`tool_context.state.get("temp:cofacts_token")`. This silently never worked: it always
returned `None`, so every GraphQL call went out unauthenticated with no error to signal
the failure.

Scope: ADK backend request handling (`adk/main.py`, `adk/cofacts_ai/auth_context.py`)
and the fact-checking tools (`adk/cofacts_ai/tools.py`); the paired change to the BFF's
`src/routes/api/run-sse.ts` request; and the container entrypoint (`adk/Dockerfile`).
Driving PR: [cofacts/ai#76](https://github.com/cofacts/ai/pull/76).

## Decision Drivers

- The token must actually reach the tools — the previous mechanism failed silently.
- The token is per-request; it must not leak across requests or into persisted session
  state (it must never appear in `list_sessions` responses).
- The mechanism must survive ADK's own handling of the HTTP `stateDelta` field.
- It must work for both authenticated requests (token present) and anonymous ones
  (token `None`, tools fall back to unauthenticated GraphQL calls).

## Considered Options

PR #76 frames this as a fix, not a comparison — the broken original versus the mechanism that
replaced it:

- **Session `stateDelta` with a `temp:`-prefixed key** — the original approach.
  Rejected: silently stripped. ADK's `BaseSessionService.append_event` calls
  `_trim_temp_delta_state`, which removes all `temp:`-prefixed keys from the event
  before they ever land in `session.state`, so `tool_context.state.get("temp:...")`
  always returns `None`. `temp:` state is only meant to be set by Python callbacks
  _within_ an invocation (mutating the `session.state` dict directly), not passed in
  over the HTTP `stateDelta` field.
- **`Authorization: Bearer` header + a `ContextVar` set by FastAPI middleware** — the
  BFF sends the token as a standard bearer header; middleware lifts it into a
  request-scoped `ContextVar` that tools read directly. **Chosen** — and it deliberately
  keeps the token out of session state, so the per-request JWT never persists into
  `list_sessions`.

## Decision Outcome

Chosen option: **`Authorization: Bearer` header → FastAPI middleware → `ContextVar`**.
The flow is:

1. `adk/cofacts_ai/auth_context.py` defines a module-level
   `cofacts_token_var: ContextVar[Optional[str]]` (default `None`).
2. `adk/main.py` is a custom entrypoint — a FastAPI app built from
   `get_fast_api_app(...)` — that **replaces the `adk api_server` CLI**. Its HTTP
   middleware reads the `Authorization` header, extracts the bearer token, and
   `cofacts_token_var.set(...)`s it for the duration of the request, resetting the
   token in a `finally` block so nothing leaks between requests.
3. `adk/cofacts_ai/tools.py` calls `cofacts_token_var.get()` at the call site and
   passes it as `auth_token` into `_execute_cofacts_graphql`, which sets the
   `Authorization: Bearer` (and `x-app-id`) headers on the `rumors-api` request.
4. `src/routes/api/run-sse.ts` sends `Authorization: Bearer <token>` instead of
   `stateDelta`; `adk/Dockerfile`'s `CMD` becomes `python main.py`.

The `ContextVar` propagates to the tools because FastAPI/Starlette's
`BaseHTTPMiddleware` runs the downstream handler in an `anyio` task group, and asyncio
copies the current `contextvars` context into new tasks — so the value set in the
middleware is visible everywhere in the request chain, including inside
`runner.run_async` and the tool functions it invokes. No session state is touched.

Replacing the CLI entrypoint with a hand-written `main.py` was a foundational change:
it is the seam where request-scoped middleware can live at all, and `main.py` later
became the natural home for the Langfuse instrumentation-ordering fix
(`setup_instrumentation()` must run _before_ `get_fast_api_app()` so Langfuse's OTel
`TracerProvider` wins the global registration instead of ADK's bare one).

### Consequences

- Good, because the token now reliably reaches the tools, and both authenticated and
  anonymous requests behave correctly (anonymous requests get `None` and fall back to
  unauthenticated GraphQL calls).
- Good, because the per-request token lives only in request-scoped context, never in
  persisted session state, so it does not appear in `list_sessions` output.
- Good, because a standard `Authorization: Bearer` header is the idiomatic transport
  and matches how the BFF already talks to `rumors-api`.
- Good, because owning `main.py` unlocked later foundational fixes hosted there — most
  notably the Langfuse instrumentation-ordering fix that depends on running setup before
  the ADK app is built.
- Bad, because the project now maintains a custom entrypoint instead of the stock
  `adk api_server` CLI, so ADK CLI/app-construction changes must be tracked by hand.
- Bad, because correctness depends on an implementation detail of Starlette/anyio
  contextvar propagation rather than an ADK-sanctioned token-passing API.

## Confirmation

Manual verification via the PR test plan: start the server with `python main.py`, issue
a `/run_sse` request with a valid session and confirm the tools receive the token and
that authenticated `rumors-api` GraphQL calls succeed; issue an unauthenticated request
(no cookie) and confirm tools receive `None` and still make unauthenticated calls. Code
review confirms tools read `cofacts_token_var.get()` and never touch session state, so
the token is absent from `list_sessions` responses.

## More Information

- Implemented in [cofacts/ai#76](https://github.com/cofacts/ai/pull/76) (8 files:
  `auth_context.py`, `main.py`, `tools.py`, `run-sse.ts`, `Dockerfile`, and supporting
  changes). The PR traced the silent failure through ADK source
  (`BaseSessionService.append_event` → `_trim_temp_delta_state`).
- This is the token-propagation mechanism that sits _under_ the BFF auth decision: it
  extends [`20260509-bff-auth-httponly-cookie`](20260509-bff-auth-httponly-cookie.md),
  which decides how the BFF obtains and relays the long-lived JWT in the first place.
