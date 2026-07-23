# AGENTS.md — maintaining `docs/`

This repo is meant to be **agent-ready**: an agent or a human should be able to understand the
system and the reasoning behind it from `docs/` alone. When you work in this repo, keeping
`docs/` current is part of the task. This file tells you how.

## What `docs/` is

- **[`docs/index.md`](docs/index.md)** — the _current-state_ overview: what the system is, how
  it starts, and its components (frontend/BFF, the ADK multi-agent backend, data, deploy). It
  stays a thin overview and links out for detail.
- **[`docs/decisions/`](docs/decisions/index.md)** — the _why_: one
  [MADR](https://adr.github.io/madr) per significant decision. `index.md` is the log and
  `adr-template.md` is the template (it explains how to fill each section).

Rule of thumb: **`index.md` = what/how it is now; `decisions/` = why we chose it.**

## When to record a decision

The habit that matters is noticing the moment you're making a **far-reaching, hard-to-reverse
choice** — one worth understanding months from now. It usually looks like a change that:

- **Spans frontend + backend** — touches both `src/` and `adk/`.
- **Changes the agent contract or orchestration** — agent roles, the `AgentTool` wiring, a
  callback in `adk/cofacts_ai/agent.py`, the `{content, sources}` JSON shape, a tool's
  input/output in `tools.py`, or the per-claim source-coverage gate.
- **Changes the data model or session persistence** — `SessionService`, the database, artifacts.
- **Changes authentication** — the cookie/JWT flow or token propagation.
- **Changes deployment or infra** — Cloud Run containers, sidecars, env, GCP project/IAM.

When you notice one, **say so and ask the user whether to capture it as a decision record** —
don't silently skip a decision this significant, and don't silently write one up either. Small,
self-contained bug fixes and refactors don't need a record.

## How to add one

Once the user agrees: copy [`docs/decisions/adr-template.md`](docs/decisions/adr-template.md)
to `docs/decisions/YYYYMMDD-short-name.md` and fill it in — the template explains each section,
including the Langfuse-evidence block and how to source a backfilled record honestly rather
than inventing options. Then add a row to [`docs/decisions/index.md`](docs/decisions/index.md)
(newest first). If the change alters the big picture (a component, a boundary, how it starts,
deploy topology), also update [`docs/index.md`](docs/index.md) and link the record.

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
