---
status: 'proposed'
date: 2026-07-30
decision-makers: [MrOrz]
consulted:
informed:
---

# Map Gemini token usage ourselves in the ADK plugin, not via the OpenInference instrumentor

## Context and Problem Statement

July 2026 Vertex AI spend on billing account `ocf - ikalatv` was **$45.95**, but Langfuse reported
only **$20.44** of Gemini cost across the two projects — **56% of real spend was invisible**. Since
Langfuse is how we reason about per-feature and per-user cost, a 2x blind spot makes it useless for
budgeting and, worse, useless for noticing a runaway agent.

The instinct was that traces were being lost. **They were not.** Pulling all 1,735 July
`GENERATION` observations from the `cofacts.ai` project and re-pricing them at the effective
per-token rates derived from the billing CSV accounts for **$45.11 of the $45.95 bill (98%)**. The
tokens are already in Langfuse. They are being priced at $0.

This is a **cost-attribution bug, not a data-loss bug** — which is why the fix belongs in how we map
usage, not in how we export spans.

Scope: `adk/instrumentation.py` (the `LangfuseTracingPlugin` and `GoogleADKInstrumentor` wiring),
the agents in `adk/cofacts_ai/agent.py` that carry server-side tools (`ai_verifier`'s `url_context`,
`ai_investigator`'s `google_search`), and — as follow-up, not fixed here — `rumors-api`'s manual
Langfuse mapping for transcripts. This record precedes the fix; it exists so the reasoning survives
an `openinference-instrumentation-google-adk` upgrade that might silently undo it.

### Langfuse evidence

- [2.95M billed tokens priced as 2,016 — `05b367a8`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/05b367a82ef86c044ce8a33f5f9e5e2c) —
  an `ai_verifier` call (`url_context` over a page set). The span carries
  `llm.token_count.prompt = 1287` and `llm.token_count.total = 2955369`; Langfuse stored
  `{input: 1287, output: 729, completion_details.reasoning: 9963, total: 2955369}` and charged
  **$0.0028**. The 2.94M-token difference is `usageMetadata.toolUsePromptTokenCount`, which Gemini
  reports _separately from_ `promptTokenCount`, counts inside `totalTokenCount`, and Google bills at
  the normal text-input rate. No OTel attribute carries it, so it only ever reaches Langfuse inside
  `total` — a key with no price. This one mechanism is ~43% of the gap.
- [A generation with no model name — `e9f23487`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/e9f23487bb5ad686cff21342603aea98) —
  `model = null` ⇒ `modelId = null` ⇒ `costDetails = {}` ⇒ **$0**, while carrying real tokens. These
  are truncated spans: ~5.6 attributes against 25.4 on healthy ones, holding only the response side
  (`llm.token_count.*`, `openinference.span.kind`, `output.mime_type`) and none of the request side
  (`llm.model_name`, `gen_ai.request.model`, `gen_ai.agent.name`, `input.value`, `session.id`).
  Langfuse resolves the model from `gen_ai.request.model` or `llm.model_name`; with both absent
  there is nothing to match a price against. 290 of 1,735 July generations (16.7%), spread across
  the whole month, 4%–50% per day. **The upstream trigger inside the instrumentor is not yet
  identified** — the proposed fix deliberately does not depend on knowing it.
- [`gemini-3.5-flash` at $0 — `33b84a45`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/33b84a45d25399a3a8475c1c08dc65cc) —
  all 30 `gemini-3.5-flash` generations (Jul 12–15) have `modelId = null` and $0, even though a
  correct managed definition ($1.50/$9.00 per Mtok) exists on the instance now. Cost is computed
  **at ingestion and never backfilled**, so these were ingested while this self-hosted instance's
  managed model list still predated Gemini 3.5 Flash. They are permanently $0. Separately: that
  model id appears nowhere in this repo on `master` — worth finding which revision ran it.

Aggregated, grouping unpriced tokens by `gen_ai.agent.name` localizes cause 1 precisely — it is
`url_context`, not grounding in general:

| agent                            | generations | input priced | **tool-use (unpriced)** |  output | **reasoning (unpriced)** |
| -------------------------------- | ----------: | -----------: | ----------------------: | ------: | -----------------------: |
| `verifier` (`url_context`)       |         175 |    4,200,299 |          **29,279,079** | 163,958 |                  952,633 |
| `investigator` (`google_search`) |         197 |    4,841,309 |                       0 | 208,903 |                  469,376 |
| `writer`                         |         510 |   15,887,776 |                       0 | 303,945 |                  229,390 |
| 4× `proofreader_*`               |         459 |      351,161 |                       0 | 494,566 |                  578,643 |

**77.6% of July generations have `total != input + output`.** June shows the same shape (85.1%), so
this is not a one-month artifact.

## Decision Drivers

- Cost per feature and per user has to be trustworthy in Langfuse, or we cannot see a runaway agent
  until the bill arrives a month later.
- Langfuse matches usage keys against price keys **exactly**; an unmatched key is silently free, not
  an error. Nothing surfaces this — the dashboard looks healthy while under-reporting 2x.
- Cost is computed **at ingestion and never backfilled**. Every day we do not fix this is
  permanently mis-priced, and no fix can repair history.
- `usageMetadata` from `google-genai` is authoritative and already in hand at the callback boundary;
  the OTel attribute set the instrumentor emits is a lossy projection of it.
- Whatever we do must survive an `openinference-instrumentation-google-adk` upgrade — silently
  reverting to lossy usage is the failure mode this record exists to prevent.
- Prefer a fix that needs no per-model Langfuse configuration, since model ids churn (four Gemini
  families appeared on this bill in one month) and a config step that must be repeated per model
  will be forgotten.

## Considered Options

- **Rely on the instrumentor; file the gaps upstream.** Report the missing
  `toolUsePromptTokenCount` attribute and the truncated spans to
  [openinference](https://github.com/Arize-ai/openinference) and wait.
- **Add project-level custom model definitions that price the instrumentor's own key names.**
  Langfuse lets user-defined models override managed ones, so define
  `gemini-3-flash-preview` etc. with prices for `completion_details.reasoning` and
  `prompt_details.audio` — the keys the instrumentor actually emits.
- **Own the mapping in `LangfuseTracingPlugin`,** reading `llm_response.usage_metadata` in an
  `after_model_callback` and overwriting the current generation's model and `usage_details`.

## Decision Outcome

Chosen option: **own the mapping in `LangfuseTracingPlugin`** — it is the only option that addresses
all three causes, and the other two cannot.

Pricing the instrumentor's key names (option 2) fixes thinking tokens and nothing else: for cause 1
there is **no key to price**, because the tool-use tokens exist only inside `total`, and for cause 2
there is **no model name to match**, so no definition can ever apply. Waiting on upstream (option 1)
leaves ~$25/month mis-attributed indefinitely, and every day of delay is unrecoverable because
Langfuse never backfills cost.

The proposed shape — `usage_metadata` is the authoritative `google.genai` object, carrying every
field the OTel attribute set drops:

```python
# LangfuseTracingPlugin.after_model_callback
um = llm_response.usage_metadata
prompt, cached = um.prompt_token_count or 0, um.cached_content_token_count or 0
get_client().update_current_generation(
    model=<the agent's model id>,                                            # cause 2
    usage_details={
        "input": prompt - cached + (um.tool_use_prompt_token_count or 0),    # cause 1
        "input_cached_tokens": cached,                                       # cause 5
        "output": um.candidates_token_count or 0,
        "output_reasoning": um.thoughts_token_count or 0,                    # cause 3
    },
)
```

Two choices in there are the reason this needs **no Langfuse configuration change at all**, and both
are easy to get wrong later:

- **Fold `tool_use_prompt_token_count` into `input`.** Google bills it at the plain input rate, and
  `input` is already priced in every managed Gemini definition. A dedicated `input_tool_use` key
  would read better in the UI but would require custom model definitions for every model — the
  churn we are trying to avoid.
- **Emit `output_reasoning` and `input_cached_tokens`, not the instrumentor's
  `completion_details.reasoning`.** Those two key names already carry correct prices in the managed
  `gemini-3-flash-preview`, `gemini-3.1-flash-lite` and `gemini-3.5-flash` definitions. This is a
  pure key-naming fix — the prices were never wrong.

Note `prompt - cached`: Gemini's `promptTokenCount` _includes_ `cachedContentTokenCount`, so they
must be split rather than added, or cached tokens get double-counted.

### Consequences

- Good, because usage comes from the authoritative `google-genai` object instead of a lossy OTel
  projection, so tool-use and thinking tokens are priced for the first time.
- Good, because it repairs the truncated `model = null` spans **without needing to know why they
  truncate** — we set the model name ourselves.
- Good, because cached tokens finally get their 90% discount. Langfuse currently _over_-charges here
  (23.37M tokens at full rate: $11.69 instead of $1.09, ~$3.7 of overstatement), which partially
  masks the under-reporting and is why the naive gap looks like $25.5 rather than $28.6.
- Good, because it needs no per-model Langfuse configuration, so a new Gemini family prices
  correctly on arrival as long as a managed definition exists.
- Bad, because we now carry a shim that duplicates what the instrumentor should do, and it must be
  re-verified on every `openinference-instrumentation-google-adk` bump — including the possibility
  that a future version fixes this and we start double-counting.
- Bad, because it depends on `after_model_callback` running inside the OpenInference `call_llm` span
  so `update_current_generation` targets the right observation. If it does not, the fallback is to
  set `langfuse.observation.model` / `langfuse.observation.usage_details` on the current span
  directly. **This must be verified during implementation, not assumed.**
- Bad, because it cannot repair history: July stays wrong, and any fix is judged only on data
  ingested after deploy.
- Neutral, because it leaves the underlying instrumentor bugs unreported. Filing them upstream is
  still worth doing; it is just not a substitute.

## Confirmation

`adk/scripts/langfuse_gcp_reconcile.py` reproduces the whole analysis above and doubles as the
regression check. It re-prices generations at rates **derived from the billing CSV** rather than
hardcoded list prices, so it keeps working when Google reprices or a new model appears:

```
uv run python scripts/langfuse_gcp_reconcile.py \
    --billing-csv <export grouped by SKU> --from 2026-07-01 --to 2026-08-01
```

It prints the per-family GCP-vs-reconstructed table with a coverage column, the per-agent unpriced
token table above, and two health metrics that need no CSV:

- **bucket mismatch** — share of generations where the priced keys don't sum to `total`. This is the
  single best invariant: `input + output + input_cached_tokens + output_reasoning == total` should
  hold for every generation. Today it fails on **77.6%**.
- **unpriced models** — generations whose model never resolved. Today **290**.

Both should be ~0 after the fix, so it can run periodically and fail loudly:

```
uv run python scripts/langfuse_gcp_reconcile.py --from … --to … \
    --max-bucket-mismatch 0.02 --max-unpriced-models 0     # exits 1 on breach
```

One caveat the script prints for itself: a Langfuse API key is **project-scoped** while the bill
covers the whole billing account, so per-family coverage below 100% may just mean another project
owns that usage. In July, `gemini 3.1 flash lite` shows 26% coverage because `rumors-api` — a
separate Langfuse project — owns most of it.

## Pros and Cons of the Options

### Rely on the instrumentor; file upstream

- Good, because the fix would land where it belongs and benefit every ADK user.
- Good, because we carry no extra code.
- Bad, because ~$25/month stays mis-attributed on an unknown timeline.
- Bad, because Langfuse never backfills cost, so every day of waiting is permanent.

### Custom model definitions pricing the instrumentor's key names

- Good, because it is pure configuration — no code, no upgrade risk.
- Good, because it would correctly price thinking tokens and `prompt_details.audio`.
- Bad, because it **cannot fix cause 1** — tool-use tokens live only in `total`, and pricing `total`
  would double-count everything else in it.
- Bad, because it **cannot fix cause 2** — with no model name, no definition ever matches.
- Bad, because it needs a hand-maintained definition per model id, indefinitely.

### Own the mapping in `LangfuseTracingPlugin`

- Good, because it fixes causes 1, 2, 3 and 5 in one place, from authoritative data.
- Good, because it reuses key names that already carry correct managed prices — no config.
- Neutral, because the plugin already exists for trace-id stamping; this is one more callback, not
  new machinery.
- Bad, because it must be re-verified on instrumentor upgrades, and could double-count if upstream
  fixes this.

## More Information

- **Not the cause, but worth knowing.** Ruled out during the investigation: sampling (no sampler
  config in either repo; Langfuse defaults to 100%); lost traces (neither repo calls
  `flush()`/`shutdownAsync()` and both run on scale-to-zero Cloud Run / pm2 — a real latent risk,
  but token capture reconciles at ~96%, leaving only ~$0.8 residual); and the two Flash Lite names
  in the dashboard, which is just `rumors-api`'s `a8c03e1` replacing a retired
  `gemini-3.1-flash-lite-preview` on 2026-07-17 — both names carry identical correct prices.
- **Follow-ups this record does not fix:**
  - `rumors-api` `src/graphql/util.js:940-946` reads only `promptTokenCount` and
    `candidatesTokenCount` out of `usageMetadata`, dropping `thoughtsTokenCount`,
    `cachedContentTokenCount` and `promptTokensDetails`. For a transcription feature that matters:
    Vertex bills Flash Lite **audio input at $0.50/Mtok against text at $0.25** — 3.78M audio and
    9.23M video tokens in July. Its `thinkingConfig: { thinkingBudget: 0 }` is a Gemini 2.5 holdover
    that does not reliably disable thinking on Gemini 3.x.
  - `rumors-api`'s `transcribeAV` opens its generation _before_ the API call with no `try/catch`, so
    a failed attempt never gets `.end()`-ed — no usage, no cost, no error level. The Jul 9–17
    retired-model incident produced a week of these.
  - Flush on shutdown in both services, plus `run.googleapis.com/cpu-throttling: "false"` in
    `service.template.yaml` so the OTel exporter still has CPU after a response finishes. Not the
    current cause, but both services can silently drop buffered spans on redeploy.
  - `adk/cofacts_ai/session_title.py:80-91` calls a raw `genai.Client()` outside
    `GoogleADKInstrumentor`, so session-title generation is billed but untraced.
- **External references.** Gemini's
  [`UsageMetadata`](https://ai.google.dev/api/generate-content#UsageMetadata) — confirms
  `toolUsePromptTokenCount` is separate from `promptTokenCount`, and that `cachedContentTokenCount`
  is a subset of it. Langfuse's
  [token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) —
  confirms exact key matching, user-defined models overriding managed ones, cost computed at
  ingestion, and no backfill.
- This continues the observability thread listed under "To backfill" in
  [`index.md`](index.md): Langfuse instrumentation ([#8](https://github.com/cofacts/ai/pull/8)),
  session grouping ([#56](https://github.com/cofacts/ai/pull/56)), per-environment traces
  ([#115](https://github.com/cofacts/ai/pull/115)). The `RootSessionSpanProcessor` in
  `adk/instrumentation.py` is a prior instance of the same pattern — a local shim compensating for
  an [openinference bug](https://github.com/Arize-ai/openinference/issues/3117) — so this would be
  the second such workaround in that file, which is itself a signal worth revisiting if a third
  appears.
