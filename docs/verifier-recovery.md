# Verifier recovery

`adk/cofacts_ai/verifier_recovery.py` contains the verifier-specific `AgentTool`
wrapper. Each attempt runs the existing verifier in a fresh single-message child
session. Recovery never reruns the writer, generates a draft, switches the answering
model, or changes other tools' error handling.

→ [Decision and tradeoffs](decisions/20261117-bounded-verifier-recovery.md).

## Budget

All verifier calls in one writer invocation share **12 attempts and 240 seconds**,
starting at the first verifier call. The mutable `temp:` state budget reserves an
attempt before awaiting, so concurrent tool calls share the same limit. A later
writer invocation gets a fresh budget. Repeating an identical completed request
within the invocation returns its cached result without another model call.

The verifier's before-model callback allows one model request per child session.
`HttpRetryOptions(attempts=1)` disables SDK HTTP retries; the wrapper owns recovery.
The installed Google Gen AI SDK can still reconnect once after a low-level transport
failure, within the same overall deadline. These are attempt/time bounds, not an
exact monetary or token quota.

## Recovery by failure

| Failure                                                     | Action                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit input-token-limit 400                              | Split identifiable URL groups into child batches of at most three sources, reducing further only when necessary.                                   |
| Other invalid-input 400                                     | Bisect identifiable sources to isolate the failure. Do not resend unchanged input or claim that the cause is token usage.                          |
| Missing object / source 404                                 | Isolate sources where possible. Remember a failed singleton by canonical GCS object identity; an HTTPS alias cannot retry the same missing object. |
| Model or endpoint 404                                       | Stop; source splitting cannot recover a missing model.                                                                                             |
| 408, 429, 500, 502, 503, 504, connection or timeout failure | At most three attempts per batch, with 1- and 2-second backoff, all charged to the shared budget.                                                  |
| Other failure, empty response, exhausted budget             | Stop and report affected claims as `尚未查核` / `UNVERIFIED`.                                                                                      |
| Caller cancellation                                         | Propagate immediately.                                                                                                                             |

Retrieved page and media content count toward input tokens. Prompt character
counts cannot predict a token-limit failure; the wrapper reacts to explicit server
errors and never estimates success from prompt length alone.

Splitting removes only excluded literal URL spans and retains the surrounding
claim text for each subset. It does not guess claim boundaries or rewrite claims.
Unicode URLs glued to prose or unbalanced URL brackets are ambiguous and are not
split. A singleton that still fails is never split again. Large claim-only input
without identifiable sources therefore stays unverified.

## Results and citations

Completed batches retain their reports and sources under the existing tool-call
citation. When a response supplies per-claim `findings`, recovery also preserves
them, restricted to that subset's sources; it does not add this field to prose-only
responses. Completion does not imply that every finding is `supported`.

Failed batches retain their source identities and failure category in readable
`UNVERIFIED` blocks, contributing no successful evidence. If every batch fails,
the result uses the existing uncitable `{error, message}` shape. Raw SDK exception
messages are not echoed because they can contain private text or signed URLs.

After an image fails to load, later successful alternative-page checks in the same
invocation still explicitly retain the missing-image state. A web report cannot
retroactively establish that the original image was retrieved.

## Offline checks

`cofacts_ai/tests/test_verifier_recovery.py` uses fake SDK errors and a fake model
through the real `AgentTool`/callback path. It covers classification, call counts,
split termination, budget sharing, backoff, cancellation, partial results, URL
boundaries, GCS aliases and citation handling. It makes no paid model calls and
contains no historical private data.
