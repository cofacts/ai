# AGENTS.md — maintaining `docs/`

This repo is meant to be **agent-ready**: an agent or a human should be able to understand the
system and the reasoning behind it from `docs/` alone. When you work in this repo, keeping
`docs/` current is part of the task. This file tells you how.

## What `docs/` is

- **[`docs/index.md`](docs/index.md)** — the *current-state* overview: what the system is, how
  it starts, and its components (frontend/BFF, the ADK multi-agent backend, data, deploy). It
  stays a thin overview and links out for detail.
- **[`docs/decisions/`](docs/decisions/index.md)** — the *why*: one
  [MADR](https://adr.github.io/madr) per significant decision. `index.md` is the log,
  `adr-template.md` the template, and `0000-…` explains why we use MADR.

Rule of thumb: **`index.md` = what/how it is now; `decisions/` = why we chose it.**

## When you MUST record a new decision

As you land a change that does any of the following, add a decision record:

- **Spans frontend + backend** — touches both `src/` and `adk/`.
- **Changes the agent contract or orchestration** — agent roles, the `AgentTool` wiring, a
  callback in `adk/cofacts_ai/agent.py`, the `{content, sources}` JSON shape, a tool's
  input/output in `tools.py`, or the per-claim source-coverage gate.
- **Changes the data model or session persistence** — `SessionService`, the database, artifacts.
- **Changes authentication** — the cookie/JWT flow or token propagation.
- **Changes deployment or infra** — Cloud Run containers, sidecars, env, GCP project/IAM.
- Any plan large enough that you'd want a design discussion. When in doubt, write one.

Small, self-contained bug fixes and refactors do **not** need a record.

## How to add a decision record

1. Copy [`docs/decisions/adr-template.md`](docs/decisions/adr-template.md) to
   `docs/decisions/YYYYMMDD-short-name.md` (date = today or the merge date; `short-name` in
   kebab-case).
2. Fill **Context and Problem Statement** — name the components in scope and link the PR/issue.
   **If a production issue drove the change, paste the Langfuse trace URL** (project base
   `https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/…`) under
   `### Langfuse evidence`, with a one-line note on what it showed and the analysis it led to.
3. Fill **Considered Options**, **Decision Outcome**, and **Consequences** (Good / Bad).
4. Add a row to [`docs/decisions/index.md`](docs/decisions/index.md) (newest first).
5. **If the change alters the big picture** (a component, a boundary, how it starts, deploy
   topology), also update [`docs/index.md`](docs/index.md) and link the new record from it.

## When to update `docs/index.md`

Whenever a component, the frontend/backend boundary, the startup/dev commands, or the
deployment topology changes. Keep it an overview — push the detail and the rationale into a
decision record and link it.

## Superseding a decision

Never delete a record. Set its `status:` to `superseded by YYYYMMDD-short-name`, add the new
record, and link them both ways.

## Repo invariants to respect (and to mention in relevant records)

- Keep `src/lib/adk.ts` (`AllTools`) in **strict sync** with `adk/cofacts_ai/tools.py` and
  `agent.py` — the frontend tool contract mirrors the backend.
- `setup_instrumentation()` must run **before** the ADK app is built in `adk/main.py`, or
  Langfuse's tracer provider loses the race with ADK's.

Docs and records are written in **English**; quote source Chinese where it adds fidelity.
