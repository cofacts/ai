---
status: "accepted"
date: 2026-05-31
decision-makers: [MrOrz]
consulted:
informed:
---

# Inject media into Gemini via before-model callbacks

## Context and Problem Statement

The Cofacts.ai ADK backend routinely fact-checks suspicious messages that center on a
YouTube video. Until now the agents saw only the *page* — `url_context` fetches a video's
HTML metadata (title, uploader, description, upload date) but never a single frame — so the
`ai_verifier` and `ai_investigator` had to reason about the video from text alone. The result
was hallucinated or incomplete perception: the model would name an event, a location, or a
person the page never stated, inferring it from training knowledge rather than from anything
actually visible or audible. Gemini on Vertex AI can watch a YouTube URL natively when it is
handed as a `FileData` part, so the question was how to feed the video into the model's
context without disturbing the rest of the pipeline.

Scope: ADK agents only — the perception layer of `ai_verifier` and `ai_investigator` (the
built-in-tool agents wrapped as `AgentTool`s under the root `ai_writer`). The orchestrator
`ai_writer` itself is deliberately kept blind to video/audio; it acts only on what the
verifier reports. Driving PR: [cofacts/ai#68](https://github.com/cofacts/ai/pull/68).

### Langfuse evidence

- [Verifier YouTube injection trace](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/3c3c0aa36707f8a1a05f2487a5fca052?timestamp=2026-05-30T07:29:47.923Z) —
  the PR test-plan trace: the YouTube URL appears both as an injected `FileData` part and,
  intact, in the request text, and the verifier's report separates page metadata (via
  `url_context`) from directly observable video content — confirming the two signals are
  genuinely complementary rather than redundant.

## Decision Drivers

- Eliminate the hallucination/incomplete-context failure mode that came from perceiving a
  video only through its page metadata.
- The two signals are complementary, not interchangeable: `url_context` supplies what the
  page *asserts* (upload date, uploader, title/description — the "when it went online" a video
  frame can never reveal), while `FileData` supplies what is *observable* (speech, visuals,
  on-screen text). A correct verification needs both layers kept distinct.
- Vertex AI natively understands a YouTube URL passed as `FileData` (one video per request,
  `mimeType` required) — reuse it instead of building a media pipeline.
- Keep the orchestrator stable: handing temporal media to the `ai_writer` makes it
  narrate/confabulate playback instead of orchestrating, so only the verifier/investigator may
  perceive video/audio.
- Resilience: a failing built-in tool (`url_context`, `google_search`) must not crash the
  whole writer session.
- Minimal footprint — implement inside ADK's existing callback hooks, no separate download,
  storage, or transcode step.

## Considered Options

- **`FileData` only** — inject the watchable video, drop the original URL text.
- **`url_context` text only** — status quo: page metadata alone, no frames.
- **Both / complementary context** — inject the video as `FileData` *and* keep the URL in the
  text so `url_context` still fetches page metadata, governed by a hard "report only what is
  visible/audible" rule.
- **Download-and-transcode** — fetch the video ourselves, extract frames/audio, and feed those
  to the model through a bespoke pipeline.

## Decision Outcome

Chosen option: **both / complementary context**, because it is the only option that gives the
verifier the full picture — the observable content *and* the page's own claims about it —
while reusing Vertex's native YouTube understanding and ADK callbacks, with no media pipeline
to build or operate. `FileData`-only loses the upload date and uploader (which frames cannot
show); `url_context`-only is the failure mode we are fixing; download-and-transcode duplicates
what Vertex already does and adds storage/transcode infrastructure for no gain.

Key decisions:

1. **`inject_youtube_filedata` as a `before_model_callback`** on `ai_verifier` and
   `ai_investigator`. It scans the user messages for YouTube URLs and appends a single
   `Part(file_data=FileData(file_uri=<url>, mime_type="video/webm"))` for the first URL of the
   latest message that has one — Vertex supports only one YouTube video per request. The
   original URL text is left untouched so `url_context` still fetches page metadata; when other
   YouTube URLs are present a `[SYSTEM]` notice enumerates the ones NOT loaded so the model
   knows to examine them in separate requests.
2. **A hard "no training knowledge" rule.** The verifier/investigator instructions require the
   model to report ONLY what is directly visible or audible and never to infer event name,
   date, location, organizer, or a person's full identity from background knowledge — writing
   "影片未說明 / cannot be determined from this video" when the media does not state it. Page
   metadata (`url_context`) and observable content (`FileData`) are reported as separate,
   labelled layers.
3. **`handle_writer_tool_error` as an `on_tool_error_callback`** on `ai_writer`. Any exception
   thrown by a built-in tool is caught and converted into a structured
   `{error, message}` dict the writer can read and continue from, so one failing tool call no
   longer crashes the whole writer session.

As shipped (PR #68): `inject_youtube_filedata` lives in `adk/cofacts_ai/agent.py` and is wired
as `before_model_callback` on `ai_investigator` and (alongside the later
`inject_cofacts_media_filedata`) on `ai_verifier`; `handle_writer_tool_error` is wired as
`on_tool_error_callback` on `ai_writer`. The same PR also upgraded the proofreader agents from
`gemini-3.1-flash-lite-preview` to the stable `gemini-3.1-flash-lite`.

### Consequences

- Good, because the verifier now perceives the video directly and its reports separate page
  metadata from observable content, removing the "invented identity/event" hallucinations that
  came from metadata-only perception.
- Good, because the pattern is implemented purely in ADK callbacks and leaves the original URL
  intact — `url_context` and Google Search grounding keep working unchanged, and no media
  storage/transcode pipeline is introduced.
- Good, because `on_tool_error_callback` makes the writer resilient: a built-in-tool failure
  degrades to a readable error instead of killing the session.
- Bad, because Vertex accepts only one YouTube video per request, so multiple videos require
  separate verifier calls (mitigated by the `[SYSTEM]` "not loaded" notice).
- Bad, because the injection is URL-shaped and YouTube-specific — raw Cofacts storage objects
  and other media types still need their own handling, which this PR does not cover.
- Bad, because correctness now leans on a prompt-level "report only what's visible/audible"
  rule rather than a hard constraint; the model can still stray and must be held to it by
  review.

## Confirmation

The PR test plan (see the Langfuse trace above) verifies that YouTube URLs are injected as
`FileData` in the LLM request, that `ai_verifier` reports both page metadata (via
`url_context`) and observable video content, and that regular web URLs still work without
`FileData` injection; graceful `ai_writer` tool-error handling in a live session is the one
open verification item. Ongoing confirmation is by code inspection that
`inject_youtube_filedata` and `handle_writer_tool_error` remain wired to the verifier/
investigator and writer in `adk/cofacts_ai/agent.py`.

## More Information

- Implemented in [cofacts/ai#68](https://github.com/cofacts/ai/pull/68) (merged 2026-05-31).
- This callback-based media-injection pattern is later generalized to all Cofacts media
  (images, and video/audio delivered as `gs://` storage objects rather than YouTube URLs) in
  [`20260606-multimodal-perception-vertex-ai`](20260606-multimodal-perception-vertex-ai.md) —
  see `inject_article_attachment` and `inject_cofacts_media_filedata` in the same module.
- The "no training knowledge / report only what is visible or audible" rule is the perception
  half of the agents' broader source-integrity contract,
  [`20260515-agent-source-integrity-contract`](20260515-agent-source-integrity-contract.md).
