---
status: 'accepted'
date: 2026-11-17
---

# Recover verifier failures by category within a shared attempt and time budget

## Context and Problem Statement

The writer's tool-error callback previously returned the same instruction for every
exception: note the failure and continue with available information. It neither
distinguished recoverable failures from invalid input nor bounded the writer's
attempts to recover by retrying, splitting sources, or changing a media URL.

The investigation summary supplied with this task described three distinct cases:
a general 400 that still failed after reducing four URLs to individual sources,
an explicit token-limit 400 that recovered when eight URLs were split into 3/3/2,
and a missing image that remained unavailable after changing its GCS URL to HTTPS.
These observations motivate separate recovery policies; they do not establish the
cause of the general 400. This implementation uses synthetic tests, not a replay
or independent revalidation of those private traces.

Scope: the verifier's `AgentTool` wrapper, verifier model-call configuration and
callbacks in `adk/cofacts_ai/agent.py`, plus their tests. Other tool paths, the
writer's drafting workflow, model selection, deployment and persistence are outside
this decision. The concurrent draft-evidence gate is a separate change; recovery
preserves its per-claim findings without defining what authorizes a draft.

## Decision Drivers

- Preserve successful source checks when only part of a request fails.
- Bound retries across parallel calls and writer-generated follow-up calls.
- Distinguish missing evidence from a supported or refuted claim.
- Account for fetched page/media content when handling token-limit failures;
  prompt length alone cannot predict their size.
- Reuse ADK's existing stateless child sessions and citation contract without a
  general retry framework, new dependency, or new persistent store.

## Considered Options

- Leave recovery to writer instructions and the generic error callback.
- Rely only on SDK HTTP retry configuration.
- Put category-specific recovery inside a verifier-only `AgentTool` wrapper.

## Decision Outcome

Chosen option: **a verifier-only `AgentTool` wrapper**, because it can retry or
split the failed verification operation while retaining successful subsets,
without rerunning the writer or duplicating drafts. Writer instructions alone
cannot enforce a budget. SDK retries can address temporary HTTP failures but
cannot isolate input sources or preserve results from successful subsets.

All verifier calls in one writer invocation share a temporary-state budget of
**12 attempts and 240 seconds**, starting at its first verifier call. Reserve each
attempt before awaiting so parallel calls consume the same counter. Each fresh
child session permits one model request; configure SDK HTTP attempts to one to
avoid stacking retry loops. Repeated identical completed requests reuse their
result within the invocation. A new invocation receives a fresh budget.

Use these recovery rules:

- An explicit token-limit 400 splits identifiable sources into groups of at most
  three, reducing further only after another failure. A generic 400 instead
  bisects sources without asserting that token usage caused the failure.
- Retain surrounding claim text and remove only excluded literal URLs. Do not
  guess claim boundaries. Ambiguous inputs and failing single sources stop
  splitting and remain unverified.
- Isolate identifiable missing sources, remembering a failed source's canonical
  GCS object identity within the invocation. An HTTPS alias cannot recover that
  same missing image. Later alternative-page results retain the missing-image
  state. A missing model or endpoint stops immediately.
- Temporary 408/429/500/502/503/504 and recognized connection/timeout failures
  receive at most three attempts per batch, with 1- and 2-second backoff, within
  the shared budget. Other failures stop. Caller cancellation propagates.

Return completed subsets together under the existing tool-call citation, retaining
their reports, sources and any structured findings supplied by the verifier. Do not
add a findings field to prose-only responses. A completed call is not itself a supported
claim. Failed subsets retain their source identities and failure category in
`UNVERIFIED` text and contribute no sources or findings. A wholly failed result
uses the existing uncitable `{error, message}` shape. Do not echo raw SDK errors,
which may contain private text or signed URLs.

### Consequences

- Successful subsets remain usable even when another source fails, and recovery
  cannot silently turn missing media into evidence from an alternative page.
- The fixed budget may leave sources unchecked, including later verifier calls
  in a long writer invocation. The deadline includes time between verifier calls;
  finishing every source is subordinate to the shared bound.
- The initial bounds allow the observed 8-to-3/3/2 recovery and a full 4-to-2-to-1
  isolation tree, but are not empirically tuned latency or cost targets.
- Conservatively refusing ambiguous URL boundaries can sacrifice recoverability.
  Large claim-only inputs stay unverified rather than being heuristically cut up.
- Attempt and time limits are not an exact token or monetary quota. The installed
  SDK may reconnect once after a low-level transport failure within the deadline.
  SDK upgrades must preserve the one-model-request-per-attempt assumption.

## Confirmation

The fake SDK/tool tests in
[`test_verifier_recovery.py`](../../adk/cofacts_ai/tests/test_verifier_recovery.py)
check classifications, call counts, split termination, shared and parallel budgets,
backoff, cancellation, partial failure, URL boundaries, media aliases and citations.
A fake model also exercises the real `AgentTool` and production callbacks, including
fresh child sessions and the single-attempt SDK configuration. No paid model calls
or historical private fixtures are required.

## More Information

- [Current recovery behavior and limits](../verifier-recovery.md)
- [Implementation](../../adk/cofacts_ai/verifier_recovery.py)
- [Structured source-integrity contract](20260515-agent-source-integrity-contract.md)
- [Footnote citations for stateless child sessions](20260722-subagent-context-citations.md)
