---
name: langfuse-usage-check
description: Check that Langfuse is pricing this project's Gemini generations completely, and diagnose it when it is not. Use after changing a model id, after upgrading google-adk / openinference-instrumentation-google-adk / the Langfuse instance, when verifying a preview deploy of a change to `adk/instrumentation.py`, or when Langfuse cost looks lower than the Vertex AI bill.
---

# Langfuse usage check

Langfuse computes cost from `usageDetails` keys matched **exactly** against a model
definition's price keys, **at ingestion time and with no backfill**. A token under a key
with no price — or on an observation whose model name never resolved — is silently free,
not an error. That is how Langfuse came to under-report real Vertex AI spend by ~2x for
months while the dashboard looked healthy. The diagnosis and the fix are in
[`docs/decisions/20260730-langfuse-usage-mapping.md`](../../../docs/decisions/20260730-langfuse-usage-mapping.md);
the mapping itself lives in `LangfuseTracingPlugin.after_model_callback`
(`adk/instrumentation.py`).

Because cost is fixed at ingestion, **every day a breach goes unnoticed is permanently
mis-priced**. Nothing can repair it afterwards, which is why this check exists at all.

## When to run it

The two invariants below break on events we cause, not at random, so run it when one
happens rather than on a schedule:

- **A model id changed** — a new Gemini family only prices correctly if this Langfuse
  instance already carries a managed definition for that exact name. It has lagged Google's
  releases before, and the failure is silent.
- **`google-adk`, `openinference-instrumentation-google-adk` or the Langfuse instance was
  upgraded** — the unit tests cover what we _emit_; only live data shows what was _stored
  and priced_. The instrumentor is unpinned, so a lockfile refresh alone can move it.
- **Verifying a preview deploy** of a change to the usage mapping, before merging.
- **Cost looks wrong** — Langfuse totals below the Vertex AI bill, or a generation at $0.

## Running it

```bash
cd .agents/skills/langfuse-usage-check
python3 check_usage.py --from 2026-09-01 --to 2026-10-01
python3 check_usage.py --from … --to … --max-unpriced-share 0.02 --max-unpriced-generations 0
python3 check_usage.py --environment preview --from 2026-09-01 --to 2026-09-02
```

Standard library only — no virtualenv. Needs `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
and `LANGFUSE_BASE_URL`, the same variables `adk/instrumentation.py` reads. With both
`--max-*` flags it exits 1 on breach, so it can gate anything that wants gating.

`--environment` maps to `LANGFUSE_TRACING_ENVIRONMENT`, which `.github/workflows/deploy.yml`
sets per deploy: `production`, `staging`, or `preview` for a PR deploy. Compare a preview
run against `staging` on the same day for a clean before/after.

`check_usage.py` is covered by `test_check_usage.py` beside it, which `adk`'s pytest run
picks up through `testpaths` — keep it that way if you change the arithmetic.

## Reading the output

Two invariants, both describing correct output rather than what any library version emits:

- **unpriced tokens** — the keys Langfuse actually priced (those with a `costDetails`
  entry) must sum to `total`. The shortfall is tokens Google billed and Langfuse gave away.
- **unpriced generations** — a generation carrying tokens must have resolved a model and
  come out with a non-zero cost.

Healthy output on the current mapping is `0.0%` and `0 / n`, with usage keys `input`,
`input_cached_tokens`, `output`, `output_reasoning` and an ingested `total`.

## Diagnosing a breach

The by-model breakdown localizes it first. Then pull one affected generation and compare
three things — `usageDetails`, `costDetails`, and the span attributes under `metadata`:

```bash
curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  "$LANGFUSE_BASE_URL/api/public/traces/<traceId>" |
  python3 -c 'import json,sys; [print(json.dumps({k: o.get(k) for k in ("model","usageDetails","costDetails","calculatedTotalCost")})) for o in json.load(sys.stdin)["observations"] if o["type"]=="GENERATION"]'
```

| what you see                                                                       | what it means                                                                                                                                 | fix                                                                      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `<unresolved>` heads the breakdown                                                 | the model name did not match any definition — check for a dated build (`…-11-2026`); managed Gemini definitions from 2.5 on end in a hard `$` | pre-register a definition for that id, or correct the name we write      |
| model resolves, but a key is missing from `costDetails`                            | that key carries no price — the spelling changed, or a new bucket appeared (audio, grounding queries)                                         | map it to a key the definition prices, or add the price                  |
| `total` exceeds everything received                                                | a bucket never arrived — the callback did not fire, or the instrumentor stopped emitting it                                                   | check `after_model_callback` still runs and still overwrites             |
| our `langfuse.observation.usage_details` is absent from the span attributes        | the plugin did not write at all on that call                                                                                                  | check the plugin is registered on that code path                         |
| our attributes are there but on a _different_ observation than `llm.token_count.*` | the callback no longer runs inside the instrumentor's `call_llm` span — the assumption the whole mapping rests on                             | see the ADR's Consequences; the fallback is writing to the span directly |

## What it cannot see

- **Calls that were never traced.** They produce no observation, so nothing to check —
  `session_title.py`'s bare `genai.Client()` is a known one.
- **Other Langfuse projects.** The API key is project-scoped; `rumors-api` has its own.
- **Wrong prices.** It checks that a price was applied, not that the price is right. Only
  the Vertex AI bill can tell you that.
