---
status: "accepted"
date: 2026-06-06
decision-makers: [MrOrz]
consulted:
informed:
---

# Multimodal media perception: writer sees images, verifier watches, delivered via Vertex AI `gs://`

## Context and Problem Statement

Cofacts articles are not always text — an article can be an IMAGE, VIDEO, or AUDIO whose
media lives as an object in `gs://cofacts-media-collection`. The ADK agent needs to *perceive*
that media through Gemini (no download/re-upload, no artifact store, no extra agent-visible
tool call), which raises two independent questions that this decision settles together:
**how** the media is delivered to Gemini, and **who** in the multi-agent pipeline actually
perceives it. Both were reached empirically, by watching real runs in Langfuse rather than
from the original implementation plan.

Scope: the ADK agents' perception model (`ai_writer` orchestrator, AgentTool-wrapped
`ai_verifier`), the Gemini platform (Developer API vs Vertex AI) and media transport, and the
deploy-time IAM the runtime service account needs. Landed together on 2026-06-06 across
[cofacts/ai#72](https://github.com/cofacts/ai/pull/72) (the flagship multimodal architecture,
closes #70) and [cofacts/ai#82](https://github.com/cofacts/ai/pull/82) (the Vertex + `gs://`
platform migration stacked underneath it).

### Langfuse evidence

- [Verifier watching carries the whole case — `42543ea6`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/42543ea6-a707-4843-90d7-2cf4bf6730a9) —
  an AI-generated bird montage with no meaningful narration and many on-screen FB/IG handles.
  The transcript is worthless; everything that matters is *visual*. The writer correctly
  forwarded the `gs://` URL to the verifier (twice) and the verifier watched it. This is the
  canonical case the writer→verifier delegation exists for.
- [Rich transcript ⇒ writer skips the video — `cc9ed3bd`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/cc9ed3bd-65aa-405f-b799-d650880118e7) —
  a U-Sport 樂運動 promo whose transcript already spelled out every point-reward rule. The
  writer extracted the claims from the transcript and called the verifier only as a web-page
  checker — it never forwarded the `gs://` media, so the visual layer (on-screen text,
  AI-generated B-roll, source watermarks) went unexamined. This motivated the instruction that
  a VIDEO/AUDIO article needs **at least one** media-watching verifier pass *even when the
  transcript looks complete*, because the transcript only covers the audio.
- [Over-iteration ⇒ timeout — `03826a6b`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/03826a6b-bbfd-4ea1-8e20-0a3f1bc31b98) —
  a Jingdezhen-ceramics craft video (article `prqoNp0B-5SQhC6hlKzX`). Delivery worked
  perfectly (3 verifier passes, all with the correct `gs://`), but with no clear-cut false
  claim the writer kept re-querying investigator/verifier and the run was cut off at ~298 s by
  an infra request timeout with no final answer. This is the latency/cost ceiling of the
  writer↔verifier loop; tracked separately in #84, not fixed here.

A cross-cutting observation from #82's traces closed the delivery question: on both correct
and broken runs the signed-URL transport was already fetching and tokenizing the video (a
constant `VIDEO 7098` tokens). Media *delivery* was never the failure; the signing/re-signing
apparatus was avoidable complexity, and the real instability was the orchestrator narrating
temporal media rather than a transport bug.

## Decision Drivers

- Gemini's HTTP(S) `file_uri` fetch is capped at ~15 MB; Cofacts video/audio (e.g. an ~80 MB
  clip) routinely exceeds it, whereas `gs://` on Vertex has no such cap.
- Signed GCS HTTPS URLs expire, forcing on-demand re-signing logic (the path #81 built).
- Langfuse showed the transport already worked, so signing was complexity with no payoff.
- Handing temporal media (VIDEO/AUDIO) to the orchestrator destabilizes it — it narrates and
  confabulates the playback instead of orchestrating.
- The verifier is the *only* agent that perceives video/audio, so anything it omits is
  invisible to the whole pipeline — its output must be an exhaustive, auditable claim inventory.
- Prefer a plain IAM grant (bucket read on the runtime service account) over bespoke signing
  infrastructure; `rumors-api` already runs on Vertex and can read `gs://cofacts-media-collection`.
- Source integrity: the writer must forward the article's `gs://` `attachmentUrl` verbatim, not
  a `cofacts.tw/article/` page URL or a hand-reconstructed `storage.googleapis.com` link.

## Considered Options

**Delivery / platform**

- **Developer API (API key) + Gemini Files-API handles** — upload each media object to the
  Files API and pass the returned handle (explored in #79).
- **Developer API + signed HTTPS `attachmentUrl` with on-demand re-signing** — inject the
  signed GCS URL as-is and rebuild it when it expires (the plan's approach, built in #81).
- **Vertex AI + native `gs://` URIs** — hand Gemini the `gs://` form and let the Vertex
  runtime service account read the bucket directly (#82). *Chosen.*

**Perceiver ("who perceives the media")**

- **Writer perceives all media directly** — inject IMAGE, VIDEO, and AUDIO into the
  orchestrator's context (#72's original thesis).
- **Writer sees IMAGE only; VIDEO/AUDIO delegated to the verifier** — the temporal media goes
  to the sub-agent that already watches/listens. *Chosen.*

## Decision Outcome

Both decisions were adopted, concrete as shipped.

**Decision 1 — Delivery on Vertex AI as native `gs://`.** The agent runs on Vertex AI
(`GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION=global`, ADC
auth) with no model-instantiation code change — ADK builds its client from the environment.
Cofacts media is delivered as a `gs://` `FileData` part; `signed_url_to_gs()` normalizes
whatever form we hold (signed HTTPS, virtual-hosted, or already-`gs://`) down to a
non-expiring `gs://` URI, and `after_tool` rewrites the writer-visible `attachmentUrl` to
`gs://` so the value the model sees is the value that works. This deleted #81's re-sign
machinery (credentials cache, expiry parsing, `_resign_gcs_blob`, `_refresh_attachment_url`)
and the `google-cloud-storage` / `google-auth` dependencies. Because Cofacts `gs://` objects
have no web page, `url_context` is explicitly *not* called on them. Deploy prerequisite: the
runtime service account needs `roles/aiplatform.user` plus `roles/storage.objectViewer` on
`cofacts-media-collection`.

**Decision 2 — Writer sees images, verifier watches temporal media.** Perception is split
across two `before_model_callback`s with two different policies:

- `inject_article_attachment` on `ai_writer` injects **IMAGE only**
  (`_WRITER_INJECTED_TYPES = {"IMAGE"}`). It appends the media as a `Part(file_data=...)`
  sibling at the `content.parts` level (not `FunctionResponse.parts`, which is a Python-SDK-only
  field never transmitted to the model), de-duped per URI, handling every
  `get_single_cofacts_article` response in a turn. A still image has no temporal playback to
  confabulate and the writer genuinely needs to see it (manipulated charts, doctored photos).
- VIDEO/AUDIO are deliberately **withheld** from the writer. For spoken claims the writer works
  from the transcript Cofacts already extracts into the article text, and delegates
  watching/listening to `ai_verifier` — the sole media-watcher. `inject_cofacts_media_filedata`
  on the verifier detects a Cofacts media URL (`_COFACTS_MEDIA_URL_RE`, matching `gs://` or GCS
  HTTPS for `cofacts-media-collection`) in the writer's plain-text delegation and appends it as
  a `gs://` `FileData` part. The verifier returns an exhaustive, atomic, numbered claim
  inventory covering both the audio and visual layers, and supports targeted re-watch
  follow-ups. Even when the transcript looks complete, at least one media-watching verifier pass
  is required (regression guard for `cc9ed3bd`).

### Consequences

- Good, because `gs://` on Vertex has no ~15 MB cap, so ~80 MB videos deliver without
  truncation, and signed-URL expiry / re-signing code is gone entirely — less surface, fewer
  failure modes.
- Good, because delivery is now a one-time IAM grant on an identity the project already has,
  reusing the Vertex project `rumors-api` runs on, instead of bespoke signing infrastructure.
- Good, because the orchestrator stays stable — it no longer narrates/confabulates temporal
  playback — while the verifier, the only agent that perceives video/audio, produces an
  auditable, atomic claim inventory the writer can reason over.
- Good, because the writer still sees still images directly (manipulation checks) with no extra
  agent-visible tool call.
- Bad, because media delivery is now tied to Vertex AI + ADC and depends on a bucket-read IAM
  grant on the runtime service account — a deploy prerequisite that fails opaquely if missing.
- Bad, because two callbacks with two different injection policies (writer IMAGE-only vs
  verifier all Cofacts media) must be kept in sync.
- Bad, because the verifier is a single point of perception for temporal media: whatever it
  omits is invisible to the whole pipeline.
- Bad, because the writer↔verifier loop has a latency/cost ceiling — over-iteration can hit the
  ~298 s infra timeout with no answer (session `03826a6b`); tracked in #84, not fixed here.
- Bad, because it depends on the writer forwarding the `gs://` `attachmentUrl` verbatim; a page
  URL or hand-built `storage.googleapis.com` link never matches the injection regex and silently
  drops all video verification.

## Confirmation

Local unit checks cover the URL→`gs://` conversion (path-style / virtual-hosted / already-`gs://`
passthrough), MIME inference from the path segment, the `_COFACTS_MEDIA_URL_RE` matching,
`after_tool`'s `attachmentUrl` rewrite, writer IMAGE-only injection, verifier injection, and
idempotency (no duplicate `FileData` on re-run). Manual verification on a Vertex-configured
deployment (from #82's checklist): traces hit `*-aiplatform.googleapis.com`; re-run the
porcelain-video article `prqoNp0B-5SQhC6hlKzX` 2–3× and confirm the verifier describes the
porcelain video (not "eID/TSMC" or "phone-case") and returns an atomic inventory, the writer
composes from that inventory plus the transcript with no video `FileData` on the writer, and
there is no `uid:`/`pid=` handle leak or runaway loop; smoke-test an IMAGE article (writer still
receives the image as `FileData`); confirm `url_context` still populates sources for a normal web
URL while the `gs://` media URL is absent from sources; and confirm all model IDs resolve on
Vertex `global`.

## More Information

- Implemented across [cofacts/ai#72](https://github.com/cofacts/ai/pull/72) — the flagship
  multimodal architecture framed around "who perceives the media, and how" (closes #70) — and
  [cofacts/ai#82](https://github.com/cofacts/ai/pull/82), the platform migration to Vertex AI +
  native `gs://` stacked underneath it. #82 deleted the signed-URL re-sign machinery added in
  #81; earlier delivery approaches were explored in #79 (Developer API + Files-API handles) and
  #81 (signed HTTPS + re-signing). The writer↔verifier over-iteration/timeout is tracked in #84.
- As shipped: `adk/cofacts_ai/media_filedata.py` (`_WRITER_INJECTED_TYPES`,
  `inject_article_attachment`, `inject_cofacts_media_filedata`, `signed_url_to_gs`),
  `adk/cofacts_ai/agent.py` (both `before_model_callback`s wired onto `ai_writer` and
  `ai_verifier`), and `adk/cofacts_ai/.env.example` (`GOOGLE_GENAI_USE_VERTEXAI`,
  `GOOGLE_CLOUD_PROJECT`, IAM notes; `GCS_ARTIFACT_BUCKET` for the artifact store).
- This generalizes [`20260531-callback-media-injection`](20260531-callback-media-injection.md):
  both callbacks here are a concrete application of the pattern of injecting `FileData` parts at
  the `content.parts` level from a `before_model_callback`.
- The "forward the `gs://` `attachmentUrl` verbatim, never a reconstructed URL" rule is an
  instance of the [`20260515-agent-source-integrity-contract`](20260515-agent-source-integrity-contract.md) —
  agents copy URLs exactly as returned and never rebuild them from memory.
