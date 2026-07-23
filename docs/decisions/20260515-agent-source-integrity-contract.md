---
status: 'accepted'
date: 2026-05-15
decision-makers: [MrOrz]
consulted:
informed:
---

# Structured source-integrity contract between the fact-checking agents

## Context and Problem Statement

The Cofacts ADK backend (`adk/cofacts_ai/`) is a hierarchical multi-agent system: a root
`ai_writer` orchestrator drives `AgentTool`-wrapped specialists — `ai_investigator`
(`google_search`), `ai_verifier` (`url_context`), and four `ai_proofreader_*` — and finally
emits a reply through `draft_factcheck_response`. In production the writer was citing sources
that did not exist: it hallucinated "cleaner" URLs from training data instead of copying the
exact grounded URLs, because the sub-agents handed it their sources embedded in narrative
prose, and the model reconstructed the links from memory rather than transcribing them. A
reply on Cofacts that cites a fabricated URL is a serious quality and trust failure.

The scope of this decision is the ADK multi-agent contract — specifically the handoff between
the writer, the investigator, and the verifier: what shape their outputs take, which agent is
authoritative for a source, and what the writer must prove before it is allowed to draft. It
was implemented in [cofacts/ai#55](https://github.com/cofacts/ai/pull/55) (the source-integrity
rewrite) and hardened in [cofacts/ai#77](https://github.com/cofacts/ai/pull/77) (orchestration
discipline + source-coverage enforcement).

### Langfuse evidence

- [#55 root-cause session `3b7812cd`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/3b7812cd-5e6f-4b15-b7d7-ea904199ca44) —
  the writer emitted "cleaner"-looking URLs that were absent from the investigator's grounded
  results; the model had reconstructed them from training data. Analysis: because sources
  lived inside prose, the writer treated URLs as something to _compose_ rather than _copy_ —
  a structural problem, not a prompt-wording problem.
- [#77 session `1878006f`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/1878006f-c8c4-443d-968c-5a77db4dbe50)
  and [#77 session `ebc732b2`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/ebc732b2-9607-415d-8561-79bd0066403e) —
  two runs on the _same_ YouTube-Shorts message (Taiwan / ALTIUS drone procurement). The
  writer never proactively asked the verifier to enumerate the video's claims (the human had
  to type "請 verifier 看影片整理 claims" every time), and its `references` failed to cover
  every factual number in the reply. Analysis: `grounding_supports` over-attributed — measured
  **avg 4.5 sources per sentence, up to 9** — and the over-cited claims were exactly the ones
  the verifier later marked unsupported; even after a ✗, the writer re-submitted the same or
  mislabeled URLs. Nothing forced claim→source coverage.
- [#77 session `2d97c04f`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/sessions/2d97c04f-eb5c-4461-a4c4-42187d6d3c2b) —
  the fact-checker gave up and had the writer produce a handover prompt, ran it through Gemini
  Pro and Claude Opus, then pasted the results back. Analysis: even fed two complete external
  investigations, the writer's final citations _still_ did not cover all factual claims —
  proving the gap was in the writer's orchestration and the claim↔source data flow, not in the
  sub-agents (investigator/verifier worked fine) or the prose.
- [#55 test-plan trace `4f11af14`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/4f11af14f7758425cba14ff0653039ce?timestamp=2026-05-15T04:23:41.975Z) —
  post-fix verification that the investigator tool response is now structured JSON and the
  writer cites only URLs present in `sources` (no hallucinated domains).

## Decision Drivers

- A cited URL must be one the writer could only have _copied_ from an agent — a URL the model
  can write without looking at `sources` is, by definition, a hallucination.
- Every factual statement or number in a published reply must map to a source that a
  page-reading agent has confirmed actually supports it.
- One agent must be the single source of truth for "which URL backs which claim"; a flat,
  undifferentiated source list does not carry that information.
- LLM context must be kept clean — the ~2000-token Google search-suggestion widget HTML was
  pure noise to the reasoning model while still needed by the frontend.
- ADK / Vertex tooling constraints: built-in tools (`google_search`, `url_context`) cannot be
  mixed with function-calling in one agent, and at the time of #55 `url_context` was
  incompatible with `thinking_config` (400 INVALID_ARGUMENT).
- The writer tended to conclude too early — drafting before research and verification had
  returned.

## Considered Options

- **Keep sources in narrative prose and only strengthen anti-hallucination instructions** —
  tell the writer harder to copy URLs exactly.
- **Trust Gemini's `grounding_supports` for claim→source attribution** — surface the model's
  per-segment source IDs and let the writer cite from them.
- **Swap the writer to a stronger model (Gemini Pro / Claude Opus)** to reduce hallucination
  and improve instruction-following.
- **A structured source-integrity contract** — machine-serialized `{content, sources}` JSON
  handoffs the writer cannot misinterpret, a dedicated page-reading verifier as the source of
  truth, and a runtime coverage gate on the draft tool.

## Decision Outcome

Chosen option: **the structured source-integrity contract**, because the root cause was
structural (sources buried in prose, no authoritative confirmer, no coverage check) and only a
structural fix — not more prompting or a bigger model — removes the class of failure. The
other options were rejected: prose-plus-instructions left the writer free to reconstruct URLs;
`grounding_supports` demonstrably over-attributed and was removed; and the model swap was
explicitly deferred by the maintainer (flash prose was fine; the sub-agents worked), pending a
flash-vs-pro A/B after these fixes landed.

The contract, as shipped across #55 and #77:

1. **Structured `{content, sources}` JSON handoff.** The investigator's and verifier's
   `after_model_callback`s (`append_grounding_sources`, `append_url_context_sources` in
   `agent.py`) serialize each sub-agent's output as JSON the writer _cannot misinterpret_;
   `sources` is a list of `{title, url}`. The writer's `after_tool` callback deserializes it
   back into a structured dict. URLs are extracted mechanically from grounding chunks — the
   investigator is forbidden from putting any URL in its prose.
2. **Verifier redesigned as an n×m claims×URLs `url_context` confirmer.** Given a list of
   claims and real `https://` URLs, it reads every page (up to 20 in one call) and returns a
   per-claim report marking each URL ✓/✗ with verbatim quotes. `url_context` returns real URLs
   directly, so no redirect resolution or hallucination-stripping is needed. #55 documented the
   ADK constraint that `url_context` was incompatible with `thinking_config`; by #77 that
   restriction had lifted and the verifier — the most faithfulness-critical step — was raised
   to `thinking_level=HIGH`.
3. **Search-widget HTML → ADK artifact.** The ~2000-token Google search-suggestion widget is
   pulled out of LLM context and persisted by `after_tool` as a GCS artifact
   (`search-widget-<function_call_id>.html`) keyed by the tool-call id, so the frontend can
   render the suggestion pills without the bytes ever reaching the model.
4. **Mandatory verification.** Verification is a required writer step ("REQUIRED: Source
   Verification"), with a fixed Claims + URLs input format; the earlier "if you have not
   already done so" escape hatch was removed.
5. **Per-claim `claim_sources` coverage gate.** `draft_factcheck_response` in `tools.py` takes
   a `claim_sources` list of `{claim, source_url, verifier_confirmed}` and **rejects** the
   draft unless every factual claim maps to a `verifier_confirmed` URL that also appears in
   `references` (`NOT_ARTICLE` is exempt). The reference match parses the leading URL token of
   each line and compares exactly, not as a substring.
6. **Discover-vs-confirm roles.** The investigator **DISCOVERS** — its `sources[]` are
   _candidates only_. The verifier **CONFIRMS** — it reads the pages and is the source of
   truth for which URL supports which claim. Final citations come exclusively from the
   verifier's ✓ output; a ✗ claim must be dropped or re-verified against a _different_ source,
   never re-submitted or relabeled.
7. **Orchestration discipline.** Claim-extraction first (for video/URL messages the writer's
   first action is to delegate claim enumeration to the verifier, which can actually watch the
   media), draft last (`draft_factcheck_response` is never called in the same turn as any other
   tool), with editorial/negative constraints tracked in a running list and re-checked before
   drafting. The unreliable `grounding_supports` field was removed entirely.

### Consequences

- Good, because a hallucinated URL is now structurally impossible to cite cleanly: the writer
  only ever sees URLs it copied from `sources[].url`, and the coverage gate refuses any draft
  whose claims are not backed by a verifier-confirmed reference.
- Good, because responsibility is unambiguous — the verifier is the single source of truth for
  claim→source support, so the writer no longer guesses which page backs which number.
- Good, because pulling the widget HTML into an artifact both cuts ~2000 tokens of context
  noise per investigator call and preserves the frontend's search-suggestion UI.
- Good, because "draft last" and mandatory verification stop the writer concluding before the
  evidence is in.
- Bad, because the contract adds round-trips and latency: a video message now costs at least
  two verifier passes (enumerate, then verify) plus the investigator, and the HIGH thinking
  budget on the verifier is slower.
- Bad, because the JSON handoff is a private convention carried in callbacks — a sub-agent that
  fails to emit the expected shape, or a future ADK change to grounding metadata, silently
  degrades the writer's inputs.
- Bad, because the gate enforces _coverage and provenance_, not _correctness_: it guarantees
  each claim has a verifier-✓ URL in `references`, not that the human should agree with the
  verdict.

## Confirmation

- The `claim_sources` gate in `draft_factcheck_response` is a runtime check that rejects any
  non-conformant draft (missing / unconfirmed / url-not-in-references / malformed entries),
  unit-sanity-checked in #77 including the substring false-positive case; `NOT_ARTICLE` and a
  well-formed draft are accepted.
- `python -m py_compile` passes and the agent module imports cleanly (verifier thinking = HIGH;
  no `grounding_supports` in `agent.py` / `adk.ts`).
- End-to-end Langfuse verification: #55's test-plan trace confirms structured investigator
  output and no hallucinated domains; #77's fresh run (session `8d667352…`) showed the correct
  tool order `get_article → verifier (enumerate) → investigator → proofreaders → verifier
(verify) → proofreaders → draft_factcheck_response (last, alone)`, with three
  `claim_sources` all `verifier_confirmed=true` and present in `references` and the gate
  returning `success:true`.

## More Information

- Implemented in [cofacts/ai#55](https://github.com/cofacts/ai/pull/55) (structured
  `{content, sources}` handoff, verifier redesign, widget→artifact, mandatory verification) and
  hardened in [cofacts/ai#77](https://github.com/cofacts/ai/pull/77) (claim-extraction-first /
  draft-last sequencing, `claim_sources` coverage gate, `grounding_supports` removed, verifier
  thinking → HIGH).
- The verifier's ability to watch/read media directly is the other half of this contract — how
  media is loaded into the sub-agents is covered by
  [`20260531-callback-media-injection`](20260531-callback-media-injection.md), and how the
  system perceives multimodal input on Vertex AI by
  [`20260606-multimodal-perception-vertex-ai`](20260606-multimodal-perception-vertex-ai.md).
- ADK constraint recorded for future reference: built-in tools (`google_search`,
  `url_context`) cannot share an agent with function-calling tools — hence the AgentTool
  wrapping — and `url_context` was incompatible with `thinking_config` as of #55 (a restriction
  since lifted, letting #77 run the verifier at HIGH).
