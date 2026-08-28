---
status: 'accepted'
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
  the normal text-input rate. On the `0.1.10` our lockfile pins, no OTel attribute carries it, so it
  only ever reaches Langfuse inside `total` — a key with no price. This one mechanism is ~43% of the
  gap. **Fixed upstream in `0.1.18`** (2026-07-30) by folding the count into
  `llm.token_count.prompt`; still live for us until we upgrade.
- [A generation with no model name — `e9f23487`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/e9f23487bb5ad686cff21342603aea98) —
  `model = null` ⇒ `modelId = null` ⇒ `costDetails = {}` ⇒ **$0**, while carrying real tokens. These
  are truncated spans: ~5.6 attributes against 25.4 on healthy ones, holding only the response side
  (`llm.token_count.*`, `openinference.span.kind`, `output.mime_type`) and none of the request side
  (`llm.model_name`, `gen_ai.request.model`, `gen_ai.agent.name`, `input.value`, `session.id`).
  Langfuse resolves the model from `gen_ai.request.model` or `llm.model_name`; with both absent
  there is nothing to match a price against. 290 of 1,735 July generations (16.7%), spread across
  the whole month, 4%–50% per day.

  **These are the root agent's own turns.** Every one of the 290 is a child of an
  `agent_run [writer]` AGENT span, and in an affected trace the writer's sub-agents — running
  concurrently, inside the same trace — are instrumented perfectly, with `["stop"]` finish reasons
  and correct model names. The split is per-invocation: 95 traces where the writer is truncated
  throughout, 105 where it is named throughout, 15 mixed. So this is not random attribute loss; it
  singles out **the one agent whose responses are streamed**. `src/routes/api/run-sse.ts` sends
  `streaming: true`, while `AgentTool` runs sub-agents non-streaming — and no null span carries a
  `gen_ai.response.finish_reasons` at all (against `["stop"]` on 94% of named spans), which is what a
  partial/streamed response looks like.

  Reading the installed sources narrows the mechanism to one specific divergence. openinference
  patches `base_llm_flow.trace_call_llm` (`openinference/instrumentation/google_adk/__init__.py:76-86`)
  and its `_TraceCallLlm` wrapper calls the original first (`_wrappers.py:204`), then writes its own
  attributes to `get_current_span()` (`:207`). ADK's `trace_call_llm`
  (`google/adk/telemetry/tracing.py:265-347`) instead writes to the `span` **passed to it** by
  `_call_llm_with_tracing`, and its very first statement is an unconditional
  `span.set_attribute('gen_ai.system', 'gcp.vertex.agent')`.

  On the writer's `call_llm` spans, the openinference attributes are present and **every** ADK
  attribute is absent — and absent from the whole trace, not merely relocated. Dumping all 23
  observations of one affected trace shows each sub-agent `call_llm` carrying both sets, while the
  writer's three carry only openinference's. Since the wrapper cannot have run without also running
  ADK's function, the two must be writing to **different span objects**: openinference to the
  recording `call_llm` span we see, ADK to something that is discarding writes. That also explains the
  attribute split exactly — the openinference attributes that survive are precisely the ones it sets
  outside its `if llm_request:` branch (`openinference.span.kind`, `output.mime_type`,
  `llm.token_count.*`), while `llm.model_name`, `llm.provider` and `input.value` all sit inside it.

  **Pinning the exact line needs a debugger on a live streamed turn, not more log archaeology** — but
  the proposed fix does not depend on it, since we set the model name ourselves either way.

  Ruled out for these spans: **user interruption.** cofacts.ai can abort a response mid-stream
  (`ChatInput` stop → `AbortController` in `src/lib/chatCache.ts` → `request.signal` forwarded to
  ADK's `/run_sse`, with nothing in `adk/` catching the resulting `CancelledError`), which is a
  plausible-looking cause and would fit "truncated". It does not survive the data: 24 of 25 affected
  traces have a final answer — a _higher_ rate than clean traces (19/25) — none carry `ERROR` level
  or a status message, and the null spans within a trace run strictly back-to-back with `input`
  growing to roughly the previous span's `total` (0/96 traces have them ending within 1s of each
  other, and 0/96 share an identical `input`). That is a sequential agent loop that ran to
  completion, not concurrent calls cut off at one instant.

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

### Why configuration cannot fix this

The obvious first instinct is that this is a Langfuse pricing-table problem — set the prices up
correctly and the numbers come right. It is worth writing down why that is false for the two largest
causes, because it is the question anyone will ask first, and because a plausible-sounding claim
circulates that `toolUsePromptTokenCount` is "automatically aggregated into the input usage type" by
Langfuse's SDKs and OTel instrumentation. It is not, and there are three independent reasons:

1. **The number never reaches Langfuse.** The complete attribute set of the `05b367a8` span above is
   24 attributes; the missing 2,943,390 tokens appear in **none** of them. The only numeric token
   attributes present are `gen_ai.usage.input_tokens` (1287), `gen_ai.usage.output_tokens` (729),
   `llm.token_count.prompt` (1287), `llm.token_count.completion` (10692),
   `llm.token_count.completion_details.reasoning` (9963) and `llm.token_count.total` (2955369). The
   tool-use count survives only as an arithmetic residue inside `total`. Nothing downstream can
   aggregate a value it never received.
2. **The OpenInference vocabulary has no slot for it.** Its
   [semantic conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html)
   define exactly eight `llm.token_count.*` attributes — `prompt`, `completion`, `total`,
   `completion_details.reasoning`, `completion_details.audio`, `prompt_details.cache_read`,
   `prompt_details.cache_write`, `prompt_details.audio`. **There is no tool-use attribute**, so the
   count cannot arrive under a name of its own. Note what does _not_ follow: having no bucket is not
   having nowhere to go. An instrumentor can fold the count into `prompt` — which is what Google
   bills it as — and `0.1.18` does exactly that, with no spec change. That is also the fold chosen
   for our shim below, and for the same reason: `prompt` already carries a price.
3. **`total` is reserved, so it cannot be priced as a workaround.** Langfuse's docs define it as
   "not a bucket itself but spans all buckets and equals their sum" — a derived aggregate, not a
   priceable bucket. Buckets are assumed mutually exclusive with `total == sum(buckets)`, and our
   spans violate that invariant on 77.6% of generations. A pricing table assigns prices to buckets;
   it cannot invent a bucket that was never sent.

Two related dead ends, for the record. `usageDetailPattern` in a pricing tier's conditions (e.g.
`{"operator": "gt", "value": 200000, "usageDetailPattern": "(input|prompt|cached)"}`) selects which
_already-present_ keys count toward a tier threshold — it does not extract or create usage keys.
And cause 2 is unreachable by construction: model definitions match by regex against the model name,
and there is no model name, so no pattern can ever apply.

Langfuse's ingestion is likewise not a generic absorber — it is an allowlist of known key spellings
(`extractGenericGenAiUsageDetails`). [langfuse#13571](https://github.com/langfuse/langfuse/issues/13571)
is the same bug shape as our cause 3, on canonical OpenInference names: `prompt_details.cache_read`
was passed through unrecognised, so cache tokens went unpriced and a production account under-reported
cost by **~30%**. It was fixed by adding the spellings to the resolver chain. That precedent matters
for how we split the work below.

### We are on the official integration path

Nothing above is the consequence of a misconfiguration on our side, and a future reader should not
start from that assumption. Langfuse's
[Google ADK guide](https://langfuse.com/integrations/frameworks/google-adk) recommends exactly what
`adk/instrumentation.py` does — `pip install openinference-instrumentation-google-adk`, then
`GoogleADKInstrumentor().instrument()` with the three `LANGFUSE_*` env vars. It presents no
alternative and labels nothing else recommended. The gaps are in that path, not in our use of it.

What differs is the regime it was validated in. The guide's example is a notebook: one agent, one
run, non-streaming, success measured by "spans appear in the UI". Ours is a long-lived FastAPI
service running a streamed multi-agent tree where the number that matters is a dollar figure. Three
consequences follow, and each maps onto a cause above:

- **openinference rewires ADK rather than observing it.** At `instrument()` it does
  `setattr(base_llm_flow, "tracer", self._tracer)`, monkeypatches `trace_call_llm` and
  `trace_tool_call`, and neuters the `runners` / `base_agent` / `telemetry.tracing` tracers with a
  `_PassthroughTracer`. So the `call_llm` span is created by openinference's tracer while ADK's
  `trace_call_llm` still writes to it through the `span` **parameter** and openinference writes
  through **`get_current_span()`** — two writers holding two different references to "the span". That
  is the structural fragility behind cause 2; it does not require anyone to have configured anything
  wrongly.
- **A tracer-provider race a notebook cannot have.** `get_fast_api_app()` calls
  `set_tracer_provider()` itself, and OTel refuses to override an already-set provider — first caller
  wins. `adk/main.py` therefore instruments _before_ building the app, deliberately and with a
  comment. The guide never surfaces this hazard because there is no app in a notebook.
- **Token usage, cost, and `StreamingMode.SSE` are not mentioned in the guide at all.** Cost
  correctness was never in its scope, which is a sufficient explanation for why a ~2x error could sit
  in the recommended path unremarked.

One inversion worth recording, because it argues against the tempting "just use ADK's native OTel
export instead" reaction: ADK's own `trace_call_llm` sets only `gen_ai.usage.input_tokens` and
`gen_ai.usage.output_tokens` — **no total**. It is openinference's `llm.token_count.total` that made
`total != input + output` visible and cause 1 discoverable at all. A cleaner native-OTel setup would
have hidden ~$10.9/month with no signal to find it by. The path we are on is buggy but observable,
which is the better of the two failure modes.

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
- The causes sit at **different layers**, so one blanket answer is wrong. Cause 1 is already fixed
  upstream, so a dependency bump reaches it. Cause 3 is a Langfuse-side allowlist gap on a name that
  already exists in the OpenInference spec, with a merged fix precedent. Cause 2 is a bug in a
  library we do not control, and cause 5 a one-line omission in it: the spec has
  `prompt_details.cache_read` and `usage_metadata` has `cached_content_token_count`, and through
  `0.1.24` the instrumentor never reads it. Causes 2, 3 and 5 are what needs working around locally.

## Considered Options

- **File the reasoning-key gap upstream with Langfuse (cause 3 only).** `completion_details.reasoning`
  is already a canonical OpenInference name that Langfuse passes through without normalizing to
  `output_reasoning`. Ask for the spelling to be added to the resolver chain, exactly as
  [#13571](https://github.com/langfuse/langfuse/issues/13571) → #13572 did for
  `prompt_details.cache_read`.
- **Upgrade `openinference-instrumentation-google-adk` (`0.1.10` → `0.1.24`).** A lockfile bump — the
  instrumentor is unpinned in `pyproject.toml` — that takes cause 1 for free. Reaches nothing else.
- **Add project-level custom model definitions that price the instrumentor's own key names.**
  Langfuse lets user-defined models override managed ones, so define `gemini-3-flash-preview` etc.
  with prices for `completion_details.reasoning` and `prompt_details.audio` — the keys the
  instrumentor actually emits.
- **Drop openinference and export ADK's native OTel spans to Langfuse's OTLP endpoint.** Removes the
  monkeypatching and the two-writer arrangement behind cause 2 entirely.
- **Own the mapping in `LangfuseTracingPlugin`,** reading `llm_response.usage_metadata` in an
  `after_model_callback` and overwriting the current generation's model and `usage_details`.

## Decision Outcome

Chosen option: **upgrade the instrumentor first, then own the mapping in `LangfuseTracingPlugin`**,
and **also file the reasoning-key gap upstream** — the three are complementary, not alternatives.

Upgrade first because it is a lockfile bump that takes cause 1 with no code of ours to maintain, and
because sequencing it first keeps the shim's credit honest: whatever survives the upgrade is what the
shim actually has to earn. It is not a substitute — auditing every release from `0.1.10` to `0.1.24`
(by diffing sdists; the change is not in the changelog) shows only cause 1 moved:

| cause                 | Aug 2026 size          | upgrading fixes it?               |
| --------------------- | ---------------------- | --------------------------------- |
| 1. tool-use tokens    | $2.70 (8.63M tok)      | **yes, `0.1.18`**                 |
| 2. `model = null`     | $3.39 (9.36M tok)      | no — `_TraceCallLlm` is unchanged |
| 3. reasoning unpriced | $2.82 (1.14M tok)      | no — and Langfuse-side anyway     |
| 5. cached never sent  | ~$2.3 (over-statement) | no — the field is still unread    |

Not free of work, though: `0.1.21`+ needs `openinference-instrumentation>=0.1.59` (we run `0.1.46`)
and `openinference-semantic-conventions>=0.1.33` (`0.1.28`), and `0.1.23` adds ADK 1.32+/2.x paths
behind a version gate while we run ADK 1.26 — so validate with a real traced run, not a green
lockfile.

Own the mapping, because it is the only option that reaches causes 2, 3 and 5. Custom model
definitions cannot: for cause 2 there is **no model name to match**, and for cause 5 the
`input_cached_tokens` bucket is never sent at all — you cannot discount a bucket you do not receive.
Every day we leave those unfixed is permanently mis-priced, because Langfuse never backfills.

File cause 3 upstream anyway, because it is a genuinely different situation: the name already exists
in the spec, Langfuse simply does not normalize it, and #13571 shows that class of report getting
merged quickly. Our shim will emit `output_reasoning` and stop depending on the outcome either way,
so this costs us one issue and benefits everyone using ADK with Langfuse.

Deliberately **not** chosen for the main fix: custom model definitions. Beyond being unable to reach
causes 1, 2 and 5, a user-defined definition appears to _replace_ rather than merge with the managed
one (the docs say only that user definitions "take priority", which needs testing before relying on
it), so it would mean hand-maintaining a ~20-key price map per model id, forever, re-done on every
Google reprice. One narrow use does survive, and is worth keeping: **pre-registering a definition for
a model id before deploying it**, as a safety net against exactly the `gemini-3.5-flash` silent-$0
above, where this self-hosted instance's managed model list lagged Google's release.

The proposed shape — `usage_metadata` is the authoritative `google.genai` object, carrying every
field the OTel attribute set drops:

```python
# LangfuseTracingPlugin.after_model_callback
um = llm_response.usage_metadata
if um is None:
    return  # a streamed partial — Gemini reports usage only at terminal points
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

- **Fold `tool_use_prompt_token_count` into `input`,** as `0.1.18` upstream also does. Google bills
  it at the plain input rate and `input` is already priced in every managed Gemini definition; a
  dedicated `input_tool_use` key would read better in the UI but needs custom model definitions for
  every model — the churn we are trying to avoid.
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
  re-verified on every `openinference-instrumentation-google-adk` bump. The double-counting hazard is
  live, not hypothetical: `0.1.18` already folds tool-use into `prompt` and the dep is unpinned, so
  any lockfile refresh picks it up. What keeps that safe is that `update_current_generation`
  **overwrites** `usage_details` — a shim written to _add_ to existing usage breaks the moment the
  lockfile moves. Treat overwrite as load-bearing.
- Bad, because it depends on `after_model_callback` running inside the OpenInference `call_llm` span
  so `update_current_generation` targets the right observation. Verified under test in both streaming
  modes rather than assumed (see Confirmation), so the contemplated fallback of writing
  `langfuse.observation.*` to the span directly is unnecessary — but the dependency is real and the
  test is what will catch it if an ADK release moves the callback out of that span.
- Bad, because on the streamed root agent the callback fires **once per chunk**, not once per call.
  `base_llm_flow.py:1169-1182` invokes `_handle_after_model_callback` inside
  `async for llm_response in agen`, and in SSE mode that generator yields every partial plus a final
  aggregated response. The `if um is None: return` guard above is therefore **load-bearing, not
  defensive**: Gemini reports usage only at terminal points, so `usage_metadata` is `None` on the
  partials and the guard is what makes the callback fire effectively once. Without it the callback
  raises `AttributeError` on the first chunk of every streamed turn.

  Note this is _not_ a double-counting risk, contrary to the obvious worry. Two independent reasons:
  usage is not carried per chunk in the first place, and `update_current_generation` **overwrites**
  `usage_details` rather than accumulating, so repeated calls are last-write-wins. The residual hazard
  is the inverse — **clobbering** a good value with an empty one. `StreamingResponseAggregator.close()`
  (`utils/streaming_utils.py`) returns the aggregated response carrying `self._usage_metadata`, but it
  can also return `None` when there are no parts, in which case no terminal response is yielded at
  all. The guard covers that too, by leaving whatever the last usage-bearing response wrote. Assert
  the `sum(priced keys) == total` invariant on a streamed turn specifically.

- Bad, because it cannot repair history: July stays wrong, and any fix is judged only on data
  ingested after deploy.
- Neutral, because emitting `output_reasoning` ourselves makes the outcome of the cause-3 upstream
  issue irrelevant to us — good for independence, but it also removes our incentive to chase it. File
  it anyway; it is a one-sided fix that helps everyone else on ADK plus Langfuse.
- Neutral, because the span-truncation bug (cause 2) and the unread cached-token field (cause 5) stay
  unreported unless someone files them. Both worth filing — cause 5 is a one-liner — but neither is
  something to wait for.

## Confirmation

**The load-bearing assumption is verified, not assumed.** `update_current_generation` writes to
whatever OTel span is current, so the whole fix depends on `after_model_callback` running inside the
instrumentor's own `call_llm` span. `cofacts_ai/tests/test_langfuse_usage_mapping.py` proves it by
running a real ADK agent through a real instrumented tracer and asserting our
`langfuse.observation.*` attributes land on the same span the instrumentor put its
`llm.token_count.*` on — in **both** streaming and non-streaming mode, since the divergence between
them is what strips the model names in the first place. The fallback of setting the attributes on the
span directly turned out not to be needed. The same file pins the arithmetic: tool-use folded into
`input`, cached split out of `prompt` rather than added, `output_reasoning` spelled to match a priced
key, the `usage_metadata is None` guard, and that an empty aggregated response cannot clobber a good
write.

Beyond the tests, `adk/scripts/langfuse_check_usage.py` is the standing check against live data:

```
uv run python scripts/langfuse_check_usage.py --from 2026-09-01 --to 2026-10-01 \
    --max-unpriced-share 0.02 --max-unpriced-generations 0     # exits 1 on breach
```

It asserts two invariants, both **version-independent** — they describe correct output rather than
what any instrumentor release emits, which matters because the dep is unpinned:

- **unpriced tokens** — priced keys must sum to `total`; the shortfall is tokens Google billed and
  Langfuse gave away. On the August window before the fix: **25.6% of 33.3M tokens**.
- **unpriced generations** — a token-carrying generation must resolve a model and cost more than $0.
  Before the fix: **152 of 901**.

Both should be ~0 after deploy. Because cost is fixed at ingestion, the check has to run against
generations produced by the new code — which is what `--environment preview` is for: a PR deploy sets
`LANGFUSE_TRACING_ENVIRONMENT=preview` (`.github/workflows/deploy.yml`) into the same Langfuse
project, so one streamed fact-check through a preview URL can be measured on its own before merging.
The `preview` baseline matches production's shape (23.9% unpriced over 17 generations), so it is a
fair comparison. The forensic half of the old `langfuse_gcp_reconcile.py` — re-pricing
against a billing CSV to locate the gap — was deleted with the fix: its findings are recorded above
for July and August, and re-deriving rates from a CSV export is not something a regression check
needs to do.

One caveat the check prints for itself: a Langfuse API key is **project-scoped** while the bill
covers the whole billing account, so a family reconciling below 100% may just mean another project
owns that usage. In July, `gemini 3.1 flash lite` shows 26% coverage because `rumors-api` — a
separate Langfuse project — owns most of it.

Re-run over **2026-08-01 .. 2026-08-28** against that period's export, the model holds on data it was
not fitted to: `gemini 3 flash` (entirely `cofacts/ai`) reconstructs to **$13.268 of its billed
$13.432 — 99%**, and flash-lite to $1.282 in-project against a billed $4.849. Total **$18.116 of
$18.282**, against a Langfuse-reported $7.939. Health metrics keep July's shape (78.6% bucket
mismatch on 883 generations, 17.3% with no model), so all three causes were still live all month.

The $3.566 flash-lite remainder no key can see is attributable rather than merely residual, by
**modality**: split those SKUs instead of blending them and 2.72M audio and 6.11M video input tokens
have no in-project counterpart, every flash-lite generation in `cofacts/ai` being a text-only
`proofreader_*`. On flash-lite that can only be `rumors-api`'s `transcribeAV`, and the implied ~34
media/day agrees with the 249 media articles over 8 days counted in the Jul 9–17 transcript outage.
The genuinely unexplained part is **$0.166 (0.9%)**, all inside `gemini 3 flash` — the untraced
`session_title.py` client and redeploy-dropped spans, both follow-ups below. Note the 153 model-less
generations are priced by `--fallback-family gemini 3 flash`, right only because cause 2 hits the
streamed root agent and `ai_writer` is `gemini-3-flash-preview` (`adk/cofacts_ai/agent.py:698`).

## Pros and Cons of the Options

### File the reasoning-key gap upstream with Langfuse (cause 3)

- Good, because the name is already canonical in the OpenInference spec — Langfuse just needs to
  normalize `completion_details.reasoning` to `output_reasoning`, a one-sided change with a merged
  precedent in #13571 → #13572.
- Good, because it benefits every ADK-plus-Langfuse user and costs us one issue.
- Neutral, because our own shim makes us independent of the outcome either way.
- Bad, because it reaches only ~$5.8 of the ~$25.5 gap, and only after a release.

### Upgrade the instrumentor (`0.1.10` → `0.1.24`)

- Good, because it removes cause 1 with no code of ours, and the dep is unpinned — a lockfile bump.
- Good, because `0.1.18` also stopped thinking tokens being double-counted into `completion`.
- Bad, because it reaches only cause 1; causes 2, 3 and 5 are unchanged through `0.1.24`.
- Bad, because it needs dependency work and a traced run to validate. It does not move the ground
  under `langfuse_check_usage.py`, whose invariants are deliberately version-independent.

### Custom model definitions pricing the instrumentor's key names

- Good, because it is pure configuration — no code, no upgrade risk.
- Good, because it would correctly price thinking tokens and `prompt_details.audio`.
- Bad, because it **cannot fix cause 1** — the tool-use tokens live only in `total`, which Langfuse
  defines as a derived sum rather than a priceable bucket.
- Bad, because it **cannot fix cause 2** — with no model name, no `matchPattern` ever matches.
- Bad, because it **cannot fix cause 5** — `input_cached_tokens` is never sent, and an absent bucket
  cannot be discounted.
- Bad, because it needs a hand-maintained ~20-key price map per model id, indefinitely, re-done on
  every Google reprice — a user definition appears to replace rather than merge with the managed one.
- Good, in one narrow role worth keeping: pre-registering a definition for a model id **before**
  deploying it, as a safety net for when the instance's managed model list lags Google.

### Drop openinference for ADK's native OTel export

- Good, because it removes the monkeypatching and the span-parameter-versus-`get_current_span()`
  split, which is the structural cause of the truncated spans.
- Good, because ADK sets `gen_ai.request.model` unconditionally, so the model name would never go
  missing.
- Bad, because ADK sets only `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` — **no
  total**, no reasoning, no cached, no tool-use. Cause 1 would become **undetectable**: without
  `llm.token_count.total` there is nothing to compare against, and ~$10.9/month would go missing with
  no signal at all. Strictly worse than a visible bug.
- Bad, because it abandons the officially recommended path, so we would own every future integration
  question ourselves.
- Neutral, because it is orthogonal to the chosen fix: our plugin reads `usage_metadata` directly and
  would keep working under either exporter.

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
  - Send openinference a one-line PR for cause 5: read `cached_content_token_count` and yield
    `LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ`. Spec attribute exists, field exists, nothing else
    changes — the most likely of the upstream gaps to land, and we can write it ourselves.
  - Confirm the streaming trigger behind cause 2 with a live repro: run one fact-check through
    `/run_sse` and one through a non-streaming call, and compare whether the writer's `call_llm`
    spans carry `llm.model_name` and a finish reason. If streaming is confirmed, that is worth an
    openinference issue in its own right — it silently un-instruments the root agent of every
    streamed ADK deployment, which is a far broader problem than our cost gap.
  - Client aborts are unguarded end to end (`request.signal` → `CancelledError` inside ADK's Runner,
    nothing in `adk/` catching it). Not the cause of any truncated span we found, but it does mean an
    aborted run's spans depend entirely on ADK's internal cancellation handling. Worth a deliberate
    look rather than leaving it to chance.
- **External references**, in the order the argument uses them:
  - Gemini [`UsageMetadata`](https://ai.google.dev/api/generate-content#UsageMetadata) —
    `toolUsePromptTokenCount` is separate from `promptTokenCount` and counted in `totalTokenCount`;
    `cachedContentTokenCount` is a _subset_ of `promptTokenCount` (hence `prompt - cached`).
  - [OpenInference semantic conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html) —
    the eight `llm.token_count.*` attributes, with **no tool-use attribute**. This is the spec-level
    gap behind cause 1, and the reason a library-only fix is not possible.
  - Langfuse
    [token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) —
    usage keys match price keys _exactly_; buckets are mutually exclusive; `total` is "not a bucket
    itself but spans all buckets and equals their sum"; user-defined models take priority over
    managed ones; cost is computed at ingestion with **no backfill**.
  - Langfuse's [Google ADK integration guide](https://langfuse.com/integrations/frameworks/google-adk) —
    the recommended path, which is the one we are on. Note what it does _not_ cover: token usage,
    cost, and streaming.
  - [langfuse#13571](https://github.com/langfuse/langfuse/issues/13571) (closed by #13572) — the
    prior art for cause 3. Langfuse's `extractGenericGenAiUsageDetails` is an allowlist of key
    spellings, not a generic absorber; canonical OpenInference `prompt_details.cache_read` went
    unrecognised and under-reported a production account's cost by ~30%. Fixed by adding the
    spellings to the resolver chain.
  - The widely-surfaced claim that `tool_use_prompt_token_count` is "automatically aggregated into
    the input usage type" is **version-dependent**: false on the `0.1.10` we run, true on `0.1.18`+.
    Check the installed `_wrappers.py` rather than a summary.
- This continues the observability thread listed under "To backfill" in
  [`index.md`](index.md): Langfuse instrumentation ([#8](https://github.com/cofacts/ai/pull/8)),
  session grouping ([#56](https://github.com/cofacts/ai/pull/56)), per-environment traces
  ([#115](https://github.com/cofacts/ai/pull/115)). The `RootSessionSpanProcessor` in
  `adk/instrumentation.py` is a prior instance of the same pattern — a local shim compensating for
  an [openinference bug](https://github.com/Arize-ai/openinference/issues/3117) — so this would be
  the second such workaround in that file, which is itself a signal worth revisiting if a third
  appears.
