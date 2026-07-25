# AGENTS.md — maintaining `docs/`

This repo is meant to be **agent-ready**: an agent or a human should be able to understand the
system and the reasoning behind it from `docs/` alone. When you work in this repo, keeping
`docs/` current is part of the task. This file tells you how.

## What `docs/` is

- **[`docs/index.md`](docs/index.md)** — the _current-state_ overview: what the system is, how
  it starts, and its components (frontend/BFF, the ADK multi-agent backend, data, deploy). It
  stays a thin overview and links out for detail.
- **[`docs/decisions/`](docs/decisions/index.md)** — the _why_: one
  [MADR](https://adr.github.io/madr) per significant decision. Its `index.md` is the log and
  the how-to (adding and superseding records); `adr-template.md` is the template.
- Not in `docs/`, but related: the top-level **[`README.md`](README.md)** is the developer
  quickstart (how to set up and run); `docs/index.md` covers the architecture.

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

If the user agrees it's worth recording, follow
[`docs/decisions/index.md`](docs/decisions/index.md) to add it.
