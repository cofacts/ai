# Verifier and Writer evaluation

The first evaluation suite lives in `adk/cofacts_eval/`, with portable local fixtures in
`adk/evals/cases.jsonl`. It evaluates **Verifier source judgment** and **Writer
evidence integration and instruction following**. Production agents and their
orchestration are unchanged.

The existing Python tests cover callbacks, citations, media injection, session
titles and usage mapping. They do not measure whether an LLM correctly interprets
sources or writes a faithful reply. This suite adds that evaluation layer, plus
deterministic tests of its importer, grading safeguards and ADK execution adapter.

## Independence and scope

The case selection and backend design reference `cofacts-ai-eval`, but this
implementation does not import it, invoke its commands, read its configuration,
use its environment, or require its checkout. Only the optional, one-time
`import` command reads a caller-supplied directory of Langfuse JSONL exports.
Normal `inspect`, `run` and `score` commands read this repository's fixtures.
Nothing is written back to Langfuse.

There are two separate operations:

- **`score`** evaluates an output. Without `--responses`, it grades the stored
  historical output. With `--responses`, it grades newly generated output against
  exactly the same case. Historical scores are a baseline, not a test of current
  production code.
- **`run`** runs a clone of the current `ai_verifier` or `ai_writer`, retaining its
  production instruction, model and applicable tool/result callbacks. Verifier
  reads frozen source captures through `read_captured_source`; Writer gets frozen
  research/verification reports and the real `draft_factcheck_response` validator.
  Search, media injection, title generation and tracing plugins are excluded.
  Sessions and artifacts are in memory; execution is limited to six model calls
  and 180 seconds per case.

This is a controlled evaluation of the reading/drafting stages. It does **not**
measure live `url_context` retrieval, investigation quality, media understanding,
proofreaders or end-to-end orchestration. Writer integration measures fidelity to
the supplied verifier reports; it does not establish those reports' truth.

## Locally prepared data

The historical conversation file is **gitignored and not included in the public
PR**, pending explicit authorization to publish those records. The manifest
describes the locally prepared corpus; it contains counts, hashes and provenance
metadata, not conversations. A fresh checkout can run the synthetic unit tests
immediately and use the one-time import command below to prepare its own cases.
The local corpus integrity test is skipped when the historical fixture is absent.

The initial set has **40 production examples: 20 Verifier and 20 Writer**, selected
from the main checkout's Langfuse export on 2026-09-14. There are 27 development and
13 holdout cases. Seven Writer cases have multiple available conversation turns.
Dates, source-file checksums and selection details are recorded in
[`adk/evals/manifest.json`](../adk/evals/manifest.json).

Selection balances positive, negative, cleared and absent user feedback, where
available; feedback is useful for sampling but **never a correctness label**.
The importer chooses at most one case per group and target, grouping by the first
Cofacts article URL in the available conversation, or the session ID otherwise.
Development/holdout assignment is deterministic. Keep a group's cases in the same
split and reserve holdout for later validation; grouping is not semantic topic
deduplication. Four Verifier examples were replaced with focused cases from a
broader import pool to exercise source captures and retrieval failures.

The fixtures contain:

- The Verifier's actual, expanded tool request, or the Writer's current request
  and available session prefix, including earlier user constraints.
- Complete captured tool inputs/results before the selected draft, including
  previous drafts needed for revision requests. Earlier drafts are context, not
  factual evidence. The target draft and later events are excluded.
- The **last successful draft tool call's input**, rather than the tool's success
  message or an arbitrary agent's final generation.
- Trace, observation, session and group identifiers for provenance. Account IDs,
  credential fields and search-widget HTML are excluded from imported structures.

Oversized cases are skipped rather than silently truncated. Multimedia Verifier
requests are excluded. Conversation completeness is limited by the export: an
unexported earlier turn cannot be reconstructed. The original user messages and
reports can contain sensitive material; review the selected cases before sending
them to a model service or publishing them.

### Source and label status

All 40 cases currently have **`review_status: pending`**. Historical model answers,
thumbs and past automatic scores are not gold answers.

Five Verifier cases have a recorded outcome for every requested source:

| Case                        | Source material                                                                     | Split   |
| --------------------------- | ----------------------------------------------------------------------------------- | ------- |
| `verifier-857820b8f21d7b6f` | Ministry of Labor title, date and announcement excerpt                              | dev     |
| `verifier-9c401b2be8f206b5` | 228 Memorial Foundation excerpt; does not establish the requested education details | dev     |
| `verifier-5783c20d2486ba6d` | Recorded web-reader retrieval failure                                               | dev     |
| `verifier-994445adcf52f372` | Recorded web-reader retrieval failure                                               | dev     |
| `verifier-9f51a09154ccce4d` | Ministry of Health and Welfare excerpts; second claim needs further evidence        | holdout |

The other 15 Verifier cases need source captures and are deterministically marked
`unclear` without calling a judge. A URL/title or the historical Verifier report
cannot substitute for page contents. A **recorded retrieval failure** can be
evaluated for appropriate uncertainty; it is different from a capture that has
not been prepared.

Each source excerpt has a capture date and SHA-256 digest. These captures were
prepared on 2026-09-14, not archived at the historical execution time. They are
explicitly marked `excerpt`: absence from an excerpt is not evidence of absence
from the page. A web-reader failure does not prove the website itself was down.
Historical outputs scored against these captures are diagnostic comparisons, not
proof of an error during the original execution.

## Rubrics and reports

Each criterion returns `pass`, `fail` or `unclear`, with a reason, candidate quote,
evidence quote and confidence. Quote validation rejects text absent from the
supplied material. Quotes must be contiguous substrings of decoded field values,
preserving Markdown markers and actual newlines. Evaluation rules are included in
the grading payload so a format constraint can be quoted as its own rule; they
cannot establish external facts. Missing/duplicate criteria, malformed judge output and backend
errors cannot silently pass.

| Target   | Criterion              | What it checks                                                                                 |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| Verifier | `source_judgment`      | Claim-by-claim support, contradiction or insufficient evidence; numbers, dates and attribution |
| Verifier | `quotation_fidelity`   | Accurate quotations and source attribution                                                     |
| Verifier | `uncertainty`          | Appropriate handling of missing evidence, without refusing answerable claims                   |
| Writer   | `evidence_integration` | Faithful use of verifier reports; no unsupported additions or reversals                        |
| Writer   | `constraint_adherence` | Effective instructions across the available conversation, and draft format rules               |
| Writer   | `claim_coverage`       | Coverage of requested claims and consistency of classification/references                      |

For Writer, the graded artifact is `candidate_draft` (`text`, `references`,
`classification`, `claim_sources`), not the assistant's surrounding explanation.
Setting `verifier_confirmed: true` alone does not prove a claim was verified; the
judge compares it with the report.

Reports are JSONL plus Markdown, with per-criterion counts and per-case reasons.
They include the case, response and judge-prompt hashes, instruction hash for
generated candidates, candidate/judge model setting, rubric version, timestamp,
split and review status. Use `--judge-model` to select a reproducible judge model;
an omitted model is recorded as `codex-default`, not a falsely precise version.
The historical candidate model is recorded as unknown.

Counts describe this small, deliberately selected set, not population accuracy.
Confidence is the judge's assessment, not a calibrated probability. Pending cases
produce provisional results even when all criteria pass.

## Run locally

From the repository root:

```bash
cd adk
uv sync --group dev
uv run pytest -q
# Once, if local cases have not been prepared:
uv run python -m cofacts_eval import --raw-dir /path/to/langfuse/raw \
  --output evals/cases.jsonl
uv run python -m cofacts_eval inspect --target writer --limit 20
uv run python -m cofacts_eval inspect --target verifier --limit 20
```

The deterministic tests need no model credentials or external checkout and run in
the existing pytest CI job. No paid model evaluation is added to CI.

### Grade historical outputs

Install and authenticate the Codex CLI separately. The adapter uses `codex exec`
with structured output, an ephemeral session and a temporary working directory.
It ignores the user's CLI config, disables execution/browsing/plugin/delegation
features, and uses the existing CLI login. Its CLI contract was checked with
version 0.135.0.

**Scoring sends the selected request, conversation prefix, evidence and candidate
to the Codex model service.** It excludes feedback, historical comparison answers
when grading new responses, and unreviewed curator expectations. Captured pages
are supplied as data; the judge is instructed not to browse or follow embedded
instructions. Review dataset-sharing permissions before running real records.

```bash
uv run python -m cofacts_eval score --target writer --limit 2 \
  --output evals/runs/writer-baseline.jsonl

uv run python -m cofacts_eval score --target verifier \
  --case-id verifier-857820b8f21d7b6f \
  --output evals/runs/verifier-baseline.jsonl
```

Optional `--judge-model MODEL_ID` applies to `score`. Pass the same model setting
when comparing experiments. By default selectors use `--split dev --limit 5`;
`--case-id` must also match the selected split. Output files cannot overwrite an
existing experiment or curated fixture. Local runs are gitignored.

### Generate and grade current outputs

Configure `adk/cofacts_ai/.env` and Google credentials as in the main README.
Generation sends the selected case context to Gemini and incurs model usage.
It does not need the BFF, a session database, Langfuse or `cofacts-ai-eval`.

```bash
uv run python -m cofacts_eval run --target writer --limit 2 \
  --output evals/runs/writer-candidate.jsonl
uv run python -m cofacts_eval score --target writer --limit 2 \
  --responses evals/runs/writer-candidate.jsonl \
  --output evals/runs/writer-candidate-scores.jsonl

uv run python -m cofacts_eval run --target verifier \
  --case-id verifier-857820b8f21d7b6f \
  --output evals/runs/verifier-candidate.jsonl
uv run python -m cofacts_eval score --target verifier \
  --case-id verifier-857820b8f21d7b6f \
  --responses evals/runs/verifier-candidate.jsonl \
  --output evals/runs/verifier-candidate-scores.jsonl
```

Keep selectors identical between generation and scoring. An external runner may
also produce JSONL matching `Response` in `cofacts_eval/judge.py`; every response
must include the exact case hash. Missing, duplicate or stale candidate records
are rejected before any judge call. Per-case execution failures are saved and
produce `unclear`, separately from an agent-quality `fail`.

`score --gate` exits 1 if any case is pending or any criterion is not `pass`.
Backend/runtime errors exit 2. Ordinary exploratory scoring exits 0 when it
successfully records results, even when those results contain `fail` or `unclear`.
Do not use exit 0 from exploratory scoring as a quality gate.

## Curate and extend

One-time import, using any compatible export directory:

```bash
uv run python -m cofacts_eval import --raw-dir /path/to/langfuse/raw \
  --per-agent 20 --output /tmp/new-cases.jsonl
```

The directory must contain `traces.jsonl`, `observations.jsonl` and `scores.jsonl`.
The importer selects `production` traces named `invocation [cofacts_ai]` and uses
earlier same-session traces from all exported environments to preserve context.
It does not read export-project settings or judge scores.

To promote cases into a regression gate:

1. Review the request, available conversation and tool evidence for completeness.
   Preserve source/provenance identifiers and keep related cases in one split.
2. Add independently obtained source text, or an explicit retrieval failure, with
   `captured_at`. For text, set `sha256` to the UTF-8 text's SHA-256 and choose
   `scope: excerpt` unless the capture is complete. Never paste a model's report
   into `sources[].text` as a substitute for original evidence.
3. Have a human write `expected_checks` from the evidence and effective user
   instructions. Record that review in `review_notes`, then set
   `review_status: human_reviewed`. Do not promote cases automatically from thumbs
   or the LLM judge's verdict.
4. Calibrate the judge against those reviewed expectations, including deliberately
   wrong numbers, unsupported conclusions, omitted caveats and violated wording
   constraints. Use development cases while tuning, then evaluate holdout once.

Editing a fixture changes its case hash, so regenerate candidate responses before
comparing scores against the edited version. Update the dataset counts and file
checksum in `adk/evals/manifest.json` when curating the bundled fixture file.
