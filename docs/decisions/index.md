# Architecture decisions

Decisions are recorded as [MADRs](https://adr.github.io/madr). Filenames are
`YYYYMMDD-short-name.md`; newest first below. See [`../../AGENTS.md`](../../AGENTS.md) for when a
change is worth recording; the how-to is under "Adding or changing a record" below. Why we use
this format is itself a record — the 2026-07-23 entry below.

| Date       | Decision                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| 2026-07-23 | [Use Markdown Any Decision Records (MADR)](20260723-use-markdown-any-decision-records.md)              |
| 2026-06-06 | [Multimodal media perception on Vertex AI](20260606-multimodal-perception-vertex-ai.md)                |
| 2026-06-03 | [Propagate the auth token to ADK via header + ContextVar](20260603-auth-token-contextvar.md)           |
| 2026-05-31 | [Inject media into Gemini via before-model callbacks](20260531-callback-media-injection.md)            |
| 2026-05-15 | [Structured source-integrity contract between the agents](20260515-agent-source-integrity-contract.md) |
| 2026-05-09 | [BFF auth via authorization-code flow + HttpOnly cookie](20260509-bff-auth-httponly-cookie.md)         |
| 2026-05-06 | [Persist ADK sessions in PostgreSQL](20260506-postgres-session-persistence.md)                         |
| 2026-03-03 | [Cloud Run multi-container deployment](20260303-cloud-run-multi-container-deploy.md)                   |

## Adding or changing a record

Copy [`adr-template.md`](adr-template.md) to `YYYYMMDD-short-name.md` (date = today or the merge
date; short-name in kebab-case) and fill it in — the template explains each section, including
the Langfuse-evidence block and how to source a backfilled record honestly rather than inventing
options. Add a row to the table above, newest first. If the change alters the big picture (a
component, a boundary, how it starts, deploy topology), also update [`../index.md`](../index.md)
and link the record.

To **supersede** a record, never delete it: set its `status:` to
`superseded by YYYYMMDD-short-name`, add the replacement, and link them both ways.

Records and docs are written in English; quote source Chinese where it adds fidelity.

## To backfill

Significant decisions still embedded in PRs and code comments, not yet written up
(contributions welcome — see "Adding or changing a record" above):

- **Observability** — Langfuse instrumentation ([#8](https://github.com/cofacts/ai/pull/8)),
  correct session grouping ([#56](https://github.com/cofacts/ai/pull/56)), per-environment
  traces ([#115](https://github.com/cofacts/ai/pull/115)).
- **Frontend** — the `parts[]` message model + SSE state machine
  ([#21](https://github.com/cofacts/ai/pull/21)); openapi-fetch + server functions
  ([#18](https://github.com/cofacts/ai/pull/18)).
