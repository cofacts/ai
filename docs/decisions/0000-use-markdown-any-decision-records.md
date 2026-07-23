---
status: 'accepted'
date: 2026-07-23
decision-makers: [Cofacts.ai maintainers]
---

# Use Markdown Any Decision Records (MADR) for architecture decisions

## Context and Problem Statement

Cofacts.ai spans a TanStack Start frontend/BFF and a Google-ADK multi-agent backend. The
reasoning behind its architecture used to live in three places an agent or a new contributor
cannot easily reach: design docs in the `cofacts/kb` repo, long pull-request descriptions,
and inline code comments. We want the "why" to live in the repo it describes, in a format
that both humans and coding agents can read, link to, and extend.

## Considered Options

- MADR (Markdown Any Decision Records)
- Nygard-style lightweight ADRs
- Keep design docs in `cofacts/kb` only
- A single long `ARCHITECTURE.md`

## Decision Outcome

Chosen option: "MADR", because it is a widely-adopted, plain-Markdown template that records
the options and consequences (not just the final choice), needs no tooling, and is trivial
for an agent to instantiate from a template. See <https://adr.github.io/madr>.

### Consequences

- Good, because each significant decision becomes a self-contained, linkable file under
  `docs/decisions/`, letting `docs/index.md` stay a thin current-state overview.
- Good, because `AGENTS.md` can give agents a precise, mechanical protocol for adding records.
- Bad, because it adds a step to large changes — but capturing that record is the point.

## More Information

- Template: [`adr-template.md`](adr-template.md).
- Filename convention: `YYYYMMDD-short-name.md`, dated when the decision was made/merged.
- Index of all records: [`index.md`](index.md).
- Maintenance protocol for agents: [`../../AGENTS.md`](../../AGENTS.md).
