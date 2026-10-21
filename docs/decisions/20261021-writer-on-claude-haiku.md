---
status: 'accepted'
date: 2026-10-21
decision-makers: [MrOrz]
consulted: [nonumpa, GGM]
informed:
---

# Run the writer on Claude Haiku 5.5 as a text-only orchestrator; the verifier perceives all media

## Context and Problem Statement

A study of production thumbs-down traces (2026-08-01 – 10-16) found that many failures were the
writer model's own judgment: it relabelled ✗ claims as confirmed, assembled URLs from patterns, and
did not tell the user when verification failed. Replaying those decision points to Claude, blind
graders preferred Claude Sonnet 5.5 and Haiku 5.5 over Gemini 3 Flash on most cases (artifact
summarised in cofacts/kb `src/meetings/2026/20261020.md`, "升級 Writer 與 ADK"). The 2026 election
period brings more suspicious political messages, so the team chose to try a Claude writer.

Scope: the `ai_writer` model and everything that had to change for it to work — how media reaches
a model that can no longer see it, how session history is made sendable to Claude, citation ids,
Langfuse cost — plus the session-database isolation the prerequisite ADK upgrade forced. All other
agents stay on Gemini. Landed in [cofacts/ai#163](https://github.com/cofacts/ai/pull/163) (ADK
1.26 → 2.12, Cloud Run on `adk_staging`) and [cofacts/ai#162](https://github.com/cofacts/ai/pull/162)
(the model switch), both tested on the `pr-162` preview on 2026-10-21.

### Langfuse evidence

All from the `preview` environment on 2026-10-21.

- [Citation ids collide under Claude — `a1e55a96`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/a1e55a96-c43a-487d-b1f3-1ea4d626b0f3) —
  every `cite_as` ended in `-tooluvrt`; Haiku noticed ("the investigator's citation id repeats")
  and worked around it by pasting quotes instead of citing. Led to the id-tail fix below.
- [English despite a Taiwanese user — `09d580f3`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/09d580f3-8313-40cc-bbea-1d14c9e43e5a) —
  given only a URL, Haiku reasoned "I'll write this in English since that's how the user
  communicated" and wrote the whole final reply in English. Led to the audience rule.
- [Verifier invents an unseen upload — `8ba829ea`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/8ba829ea-712c-4352-a020-b8ce44825638) —
  a pasted screenshot reached the verifier only as a `gs://` string (no `FileData`), and Gemini
  produced a complete, fabricated transcription of a different image. Led to the upload
  attachment and the "No media, no description" rule.
- [Upload delivered and used — `d96676ba`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/d96676ba-5297-4166-a7e4-9b287e81937b) —
  after the fix the verifier described the screenshot accurately; Haiku also caught the
  investigator inventing a TFC URL and dropped it.
- [A Gemini-era session continues on Claude — `2cb029e7`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/2cb029e7-854e-4451-ad2c-6b0f5293f819) —
  history with Gemini thoughts and `call_NNNNNN` ids loaded and continued; Haiku corrected the old
  draft's wrongly-confirmed store count.

## Decision Drivers

- Writer judgment errors are the largest class of production thumbs-down.
- Cost: per 30 days the writer cost $10.67 on Gemini 3 Flash; the estimate was $6.6–11.3 on Haiku
  5.5 and $47.5–76.1 on Sonnet 5.5 (same study).
- ADK 1.x's Claude adapter cannot carry Claude thinking blocks; fixes land only in 2.x, and ADK
  2.12 writes a `node_info` key into events that ADK 1.26 cannot read back.
- Claude on Vertex AI rejects image `url` sources (`gs://` and `https://` alike: "URL sources are
  not supported"); only base64 works. The adapter raises on `file_data`.
- Chat sessions are planned to become public, so uploads need not be private to the uploader — but
  the Vertex AI service agent can read every bucket in the project, so arbitrary `gs://` strings
  must never become `FileData`.
- Avoid long-lived session state for transient plumbing.

## Considered Options

**Writer model**

- Keep Gemini 3 Flash.
- Claude Sonnet 5.5 — best in the blind study, 5–7× the cost.
- Claude Haiku 5.5. _Chosen._

**Who perceives media once the writer is on Claude**

- Writer keeps seeing images: download `gs://` objects and inline them as base64 on every request.
- Writer is text-only; the verifier (Gemini) perceives images, video, audio and chat uploads. _Chosen._

**How a chat upload reaches the verifier** (the verifier is an AgentTool: a fresh session that
sees only the writer's `request` text)

- Match any `gs://` URI in the request — rejected, it would expose every bucket in the project.
- Regex-match URIs in the artifact bucket and guess the MIME type from the extension (first
  implementation) — fiddly with names like `user-upload-Pasted image 1.png`.
- Record the session's uploads in session state for the verifier to read — persistent state lives
  too long, and `temp:` keys are dropped when AgentTool creates the child session.
- Ask the artifact service: AgentTool gives the child a `ForwardingArtifactService` that answers
  for the calling (writer) session, so the verifier lists that session's `user-upload-*`
  artifacts and attaches an exact-match `canonical_uri` with its stored MIME type. _Chosen._

**Prompt caching for the writer** (ADK 2.12's Claude adapter supports it; nothing caches unless
the request carries `cache_control`)

- `App(context_cache_config=...)` — applies to every agent, and the Gemini sub-agents would create
  server-side cache resources (with storage cost) for single-request AgentTool sessions that are
  never reused; Gemini 3 already gets implicit caching on Vertex.
- Set `llm_request.cache_config` in the writer's own before-model callback. _Chosen._
- TTL: Claude's 1-hour cache (writes 2×) vs the default 5-minute one (writes 1.25×, renewed on every
  hit). _5 minutes_: a fact-check turn's calls are seconds to a minute apart.

**Keeping the ADK 2.12 migration off the production database**

- Change the `DATABASE_URL` secret to the staging database — invisible in code and affects every
  branch at once.
- Rewrite the URL in `deploy.yml` (`${DATABASE_URL}_staging`) so a branch opts in by containing the
  change. _Chosen._

## Decision Outcome

Chosen: Claude Haiku 5.5 as a text-only writer, with all media perceived by the verifier, uploads
attached through the forwarded artifact service, and Cloud Run (dev and PR previews) on a separate
`adk_staging` database. Haiku fixes the writer's judgment errors at about Gemini's cost, and keeping
media with the Gemini verifier avoids re-sending base64 images on every Claude call.

Concretely:

- **Model.** `Claude(model="claude-haiku-5-5", max_tokens=16000)`, adaptive thinking with
  summaries, `effort="high"`, same `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION=global`.
- **History rewrite** (`writer_request.py`, before-model): tool responses serialized whole
  (`ensure_ascii=False`) so `sources` / `cite_as` survive the adapter; media parts become text
  placeholders that keep the `gs://` URI; Gemini thoughts from older sessions are dropped. The
  rewrite is deterministic so Claude's edited-history check never fires.
- **Media.** `inject_article_attachment` is removed; the writer forwards article media and upload
  URIs to the verifier. `inject_cofacts_media_filedata` attaches Cofacts media (unchanged) and the
  calling session's uploads. The verifier instruction gains "No media, no description".
- **Audience & language.** The writer assumes Taiwanese users and readers unless told otherwise;
  everything people read, including notes between tool calls, is in Taiwan Traditional Chinese.
- **Citation ids** keep the call id's last 8 characters instead of the first 8 (Claude ids all
  start `toolu_vrtx_`; this also fixes rarer collisions of Gemini's sequential `call_NNNNNN`).
- **Cost.** `ANTHROPIC_OPEN_TELEMETRY=false` stops the Anthropic SDK's own span, which Langfuse
  would otherwise price on top of `call_llm`. A Langfuse model definition for `claude-haiku-5-5`
  carries Vertex's global prices with a >100K-input tier.
- **Prompt caching.** `prepare_writer_request` sets `ContextCacheConfig()` on the writer's requests
  only (ADK's 1800 s maps to Claude's 5-minute cache); the adapter marks the system prompt, tools and
  last message. The history rewrite above keeps each request a prefix of the next, which is what
  caching needs. `instrumentation.py` maps Claude's cache writes to `input_cache_creation` so they
  are priced at 1.25×, not as plain input.
- **Database.** `adk_staging` on the same Cloud SQL instance, cloned from production and owned by
  the app's IAM user; Cloud Run gets it through `deploy.yml`, production on GCE keeps `adk`.

### Consequences

- Good, because the writer stops relabelling ✗ claims and inventing URLs in the cases studied, and
  in preview runs it caught a sub-agent's fabricated URL and a wrongly-confirmed figure.
- Good, because the writer's cost stays close to Gemini's for normal sessions (≈$0.03–0.06 each).
- Good, because uploads are scoped to the session that made them without extra state, and a
  `gs://` string pointing anywhere else is never attached.
- Good, because preview and dev traffic can no longer write ADK 2.12 events into production.
- Bad, because the writer can no longer look at an image itself; it sees the verifier's description,
  one extra call and some latency away.
- Good, because prompt caching turns the writer's growing history into cache reads at 10% of the
  input price: on preview session `be879466` the writer cost $0.157 instead of ≈$0.486 for the same
  tokens uncached (−68%).
- Bad, because a session whose input crosses 100K tokens still pays 5× per token, cached or not.
  The usual cause is one `search_cofacts_database` result (130K characters on `be879466`); the tool
  appears in roughly a quarter to half of sessions, so trimming its output is a follow-up.
- Bad, because Vertex offers no server-side refusal fallback for Claude.
- Bad, because upload attachment relies on ADK's `ForwardingArtifactService` keeping the parent
  session's scope — an ADK change would silently stop attachment (it fails closed).
- Bad, because `adk_staging` is a snapshot: it drifts from production and must be re-cloned by hand.

## Confirmation

- `test_verifier_round_trip.py` drives the verifier through a real AgentTool: this chat's upload
  (name with spaces) is attached with its stored MIME type; the same name in another session and the
  same path in another bucket are not.
- `test_media_filedata.py`, `test_writer_request.py` and `test_writer_citations.py` cover the
  remaining unit cases (MIME source, prefix and version matching, lookup failure, placeholder
  format, citation-id tail, caching enabled for the writer without overriding an app-wide config).
- `test_langfuse_usage_mapping.py` runs a Claude response with cache reads and writes through ADK's
  adapter and checks they land on `input_cached_tokens` / `input_cache_creation` and sum to `total`.
- After a production deploy, run the `langfuse-usage-check` skill over the first full day; expect
  0% unpriced tokens and a single generation per writer call.

## More Information

- Supersedes the "writer sees images" half of
  [`20260606-multimodal-perception-vertex-ai`](20260606-multimodal-perception-vertex-ai.md); its
  Vertex `gs://` delivery decision still stands.
- Builds on [`20260531-callback-media-injection`](20260531-callback-media-injection.md),
  [`20260722-subagent-context-citations`](20260722-subagent-context-citations.md) and
  [`20260730-langfuse-usage-mapping`](20260730-langfuse-usage-mapping.md).
- The ADK 2 upgrade procedure (clone production into `adk_staging`, preview checks, the
  `node_info` rollback) comes from nonumpa's SOP on the `docs/adk2-upgrade-sop` branch.
- Follow-ups: trim `search_cofacts_database` output so sessions stay under the 100K-input tier; a
  stricter verifier tick rule, studied separately (verifier over-lenient ticks, 2026-10-21).
