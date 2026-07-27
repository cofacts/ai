---
status: 'accepted'
date: 2026-07-22
decision-makers: [MrOrz]
consulted:
informed:
---

# Reference the message and drafts by symbol in stateless sub-agent calls

## Context and Problem Statement

Every `AgentTool` call in the Cofacts ADK backend starts a **fresh, stateless, single-message
session**: the sub-agent sees nothing but the `request` string of that one call — not the
writer's conversation, not a sibling call made in the same turn, not an earlier call to the same
sub-agent. In the draft-review round the `ai_writer` fans out **four parallel `ai_proofreader_*`
calls at once**, and it had been pasting the full draft into only the **first** of them while
writing 「（內容同上）」 / 「（同上）」 ("same as above") for the other three. There is no "above"
in an isolated session, so those three received no draft and would either say so and fall back to
a boilerplate checklist, return an empty "here is how I would evaluate your draft" shell, or —
worst and hardest to notice — **answer anyway, reconstructing a plausible-sounding review from
fragments of the request**, handing the writer fabricated feedback.

This is not random omission but deliberate de-duplication: the writer knows it just wrote a long
draft and does not want to retype it four times, so it back-references a sibling call — a
reference that only holds when context is shared. Sampling 200 proofreader calls (2026-05-24 –
07-18) found **~12% ineffective**, and because the failures cluster in the review round,
**roughly a third of review rounds were invalid**; an independent re-sample of ~40 traces / 94
calls found 18 (19%) carrying a "same as above" placeholder, at 65–180 characters each, in a
near-constant "1 full + 3 placeholders" shape.

Scope: the ADK agent contract and orchestration — the `request` argument of every
`AgentTool`-wrapped sub-agent (`ai_investigator`, `ai_verifier`, the four `ai_proofreader_*`),
callbacks in `adk/cofacts_ai/agent.py` and the new `writer_symbols.py`, the
`draft_factcheck_response` contract in `tools.py` —
plus the frontend that renders draft proposals (`src/lib/chatCache.ts`, `RightDrawer.tsx`).
Driving issue: [cofacts/ai#117](https://github.com/cofacts/ai/issues/117); implemented in
[cofacts/ai#119](https://github.com/cofacts/ai/pull/119).

### Langfuse evidence

- [Session `050cf7be` / trace `921be137`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/921be137ef9dee5ef20ee136efd417d1) —
  the mechanism, caught cleanly: four parallel proofreader calls in one review round, the draft
  in full to `kmt`, 「（內容同上）」 to `dpp` / `tpp` / `minor_parties`. Analysis: the writer is
  de-duplicating a **sibling** call, so the fix has to make referencing legitimate rather than
  merely forbid the abbreviation.
- [Trace `bf5029ec`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/bf5029ec9fe25c43aa556fbecbba563f) —
  the worst single case: five wasted proofreader calls across DPP / TPP / minor parties in one
  draft-review round (張璉「光復」 draft).
- [Trace `4f3466df`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/4f3466dffdef92e0af3dcbae5bde64e1)
  and [trace `b3133d27`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/b3133d2725070409b90e11b3caae786d) —
  the dangerous class: the request says 「同上」 and the proofreader **answers regardless**,
  producing feedback with no draft behind it. Analysis: silent fabrication is worse than a
  visible refusal, so the sub-agent needs an explicit "I did not receive this" protocol.
- [Trace `33b84a45`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/33b84a45d25399a3a8475c1c08dc65cc) —
  seven review-round calls; the writer re-sent the full draft on its own in the second round.
  Analysis: self-repair happens but is **not reliable**, so it cannot be depended on.
- [Trace `74a402cb`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/74a402cb4414233c87be7d576481d84f) —
  KMT and DPP proofreaders returned `None` (empty output). A different root cause, addressed
  alongside: proofreaders had no empty-response retry, and their instructions still ended with a
  dead "transfer back to the main AI Writer" clause.

## Decision Drivers

- A sub-agent must never be asked to review content it cannot see, and must never **guess** when
  it happens.
- The writer's instinct — reference the draft instead of retyping it — is reasonable and should
  be **supported**, not merely prohibited; a prohibition alone leaves it retyping a long draft
  into four parallel calls.
- The **writer** should decide what a given call needs to see. A proofreader asked to react to
  the raw message (initial audience simulation) needs no draft; the same agent in a review round
  needs the whole thing. There is no mechanical rule that can infer which, which is exactly why
  issue #117 judged a deterministic callback-side injection infeasible.
- Whatever channel carries the content must not inflate `list_sessions`: the frontend sidebar
  reads session **state** from the list endpoint (`src/lib/chatSessions.functions.ts`), so a long
  draft in non-`temp:` state would be re-downloaded on every sidebar load.
- Proofreader feedback must be able to reference **any** version of the reply the writer has
  drafted, not only the latest, since review is iterative.
- Prefer public, documented ADK surfaces so an ADK upgrade cannot silently break the mechanism.

### ADK facts established while deciding (verified against the installed 1.26.0 source)

These findings, not intuition, drove the choice — several contradicted our prior assumptions:

- **Parallel function calls in one model turn do not see each other's state deltas.**
  `flows/llm_flows/functions.py` dispatches them with `asyncio.gather`, each with its own
  `ToolContext` and delta, merged only afterwards. So a state write and a fan-out **cannot**
  share a turn — any state-based channel would need a strict "write in a prior turn" rule.
- **`AgentTool` forwards `temp:` state to the child.** `run_async` copies parent state excluding
  only keys starting with `_adk`. The comment then in `agent.py` claiming "`temp:` state is
  stripped by `AgentTool` before forwarding" was **wrong** (it conflated _not persisted_ with
  _not forwarded_) and was corrected in this PR; that misconception is likely why the state
  channel had never been used for the draft.
- **`temp:` state is never persisted** — `DatabaseSessionService.append_event` trims it — so it
  never reaches `list_sessions`. Non-`temp:` state does.
- **ADK's native instruction templating only templates our own instruction strings**, never the
  LLM-generated `request`. `inject_session_state` runs on every `LlmAgent` string instruction,
  matches `{+[^{}]*}+`, and raises `KeyError` on an unknown key (`{key?}` is the optional form).
  A symbol written by the model into `request` is therefore _not_ interpolated — and any
  curly-brace symbol documented in the writer's _own_ instruction would be parsed as a state
  variable and crash instruction rendering.
- **`ReadonlyContext.session` is a public property**, inherited by the `Context`/`ToolContext`
  passed to callbacks — so reading the writer's event history is a supported access path, not a
  private-attribute hack.
- **There is no first-class ADK answer for this.** adk-python discussion
  [#2469](https://github.com/google/adk-python/discussions/2469) (a dynamic number of parallel
  sub-agents) is unanswered; the idiomatic ADK pattern everywhere is shared `session.state`.

## Considered Options

Reconstructed from issue [#117](https://github.com/cofacts/ai/issues/117) (its proposal and its
two follow-up comments, including a self-correction about which option the issue actually
contained) and the design discussion that produced PR #119.

- **Report-back only** — issue #117's original proposal: instruct each proofreader that it is
  stateless and must refuse to answer, rather than guess, when a request references content it
  cannot see.
- **`temp:` session state + ADK's native instruction interpolation** — have the draft tool write
  `temp:draft_for_review`, and add `{temp:draft_for_review?}` to each proofreader's instruction
  so ADK injects it automatically on every call.
- **Artifacts as the channel** — persist each draft as a GCS artifact and inject it via
  `{artifact.draft?}`.
- **A `<draft>…</draft>` marker convention in the writer's prose** — have the writer wrap drafts
  in markers in its ordinary text output and scan the assistant messages for the latest block.
- **A dedicated `save_draft` tool** as the anchor for the draft, separate from
  `draft_factcheck_response`.
- **LLM-written symbols expanded from the writer's event history**, with
  `draft_factcheck_response` itself as the draft anchor. **Chosen.**

## Decision Outcome

Chosen option: **LLM-written symbols (`[[message]]`, `[[draft]]`, `[[draft:vN]]`) expanded from
the writer's own event history in a `before_tool_callback`, with `draft_factcheck_response`
reframed as a re-callable draft-proposal tool that serves as the anchor** — because it is the
only option where the _writer decides_ what each call must see (the requirement no mechanical
rule can satisfy), the draft is _never retyped_, _any_ version stays referenceable, and nothing
is written to session state at all, so `list_sessions` is untouched. The content already exists
in the event history; copying it into state would duplicate data purely to hand it back.

The other options were rejected, or kept in a smaller role:

- **`temp:` state + native interpolation** was the leading candidate and remains a sound
  fallback, but ADK templating applies only to _our_ instruction strings, so injection is
  **unconditional** — the writer cannot choose whether a given call sees the draft, message-only
  calls pay for a draft they do not need, and only the _latest_ draft is reachable. It also
  inherits the prior-turn ordering constraint from the parallel-delta finding.
- **Artifacts** are the wrong shape for prose: `{artifact.x}` interpolates `str(types.Part)` — a
  pydantic repr, not the draft text — and adds a GCS fetch per placeholder per call.
- **The marker convention** would have given a state-free anchor, but the draft would have to be
  parsed out of free-form assistant prose, exactly the kind of unreliable heuristic #117 set out
  to avoid.
- **A dedicated `save_draft` tool** was the initial instinct — and _some_ tool call is indeed
  what gives the draft a clean, addressable anchor that free prose lacks. It lost to reusing
  `draft_factcheck_response`, whose existing validation gate turns each proposal into **free
  revision feedback** (which URLs are unverified, which claims fail coverage); a bare
  `save_draft` would have to reproduce that or forgo it.
- **Report-back was adopted too**, not as the primary fix but as the **safety net** for the one
  weakness of an opt-in mechanism: the writer can forget to write the symbol.

As shipped in PR #119:

1. **`expand_writer_symbols`, a `before_tool_callback` on `ai_writer`** (in its own module,
   `adk/cofacts_ai/writer_symbols.py`, following `media_filedata.py`). For calls to the six
   `AgentTool` sub-agents it rewrites `args['request']` in place and returns `None` so the call
   proceeds: `[[message]]` / `[[message:<articleId>]]` → the article text from the writer's own
   `get_single_cofacts_article` function-**response**; `[[draft]]` / `[[draft:vN]]` → the `text`
   argument of the latest / Nth `draft_factcheck_response` function-**call**, 1-indexed in
   submission order. Reading the _call_ arguments rather than the response means a proposal the
   validation gate **rejected** is still reviewable — useful, since reviewing prose before its
   citations are settled is legitimate.

   **A bare symbol always resolves to the most recent of its kind.** One conversation can cover
   more than one suspicious message — the user may paste a second Cofacts URL, and the writer may
   pull up a related article for comparison — so pinning `[[message]]` to the _first_ article
   fetched would silently review a new draft against an old message, the very failure class this
   record exists to remove. "Latest wins" follows the same reasoning already documented for
   `inject_youtube_filedata` ("the most recent message is the current task"), and keeps
   `[[message]]` consistent with `[[draft]]`. Because "most recent" is still a guess about intent
   when several articles are in play, `[[message:<articleId>]]` addresses one explicitly, and the
   writer is instructed to prefer that form whenever a conversation covers more than one article;
   an unknown id resolves to a marker that lists the ids actually fetched, so the writer can
   correct itself.

2. **Square brackets, deliberately, not curly braces.** These symbols are documented in the
   writer's own instruction, and ADK would parse `{draft}` there as a session-state reference and
   raise `KeyError` while rendering that very instruction. `[[…]]` sidesteps ADK's templating
   entirely.
3. **An unresolved symbol becomes an explicit `[SYSTEM: …]` marker**, never a silent drop and
   never bare literal text — so a mistake is visible in the forwarded request and in the trace.
4. **`draft_factcheck_response` reframed from a one-shot final action into a re-callable draft
   proposal** (docstring, writer instruction, and success message only — **the validation logic
   is unchanged**). Its Steps 6/7 became a propose → `[[draft]]`-review → revise loop. It keeps
   the pre-existing "call it alone, never in the same turn as another tool" rule, which now also
   guarantees a proposal is committed to the event history before any later `[[draft]]` resolves
   against it — the ordering constraint the parallel-delta finding demands, satisfied by a rule
   that already existed.
5. **A report-back protocol in all four proofreader instructions**: every call is a fresh
   conversation; if the request references something you cannot see, do not answer or guess —
   reply that you did not receive the full content and ask for it.
6. **The dead "Control Flow — transfer back to the main AI Writer" block removed** from all four
   proofreaders. An `AgentTool` child runs in an isolated runner with no `transfer_to_agent`
   tool, so the instruction was unreachable, and a model told to perform a transfer it cannot
   perform is a plausible source of the empty-output (`None`) traces.
7. **Empty-response retry extended to proofreaders** in `after_tool`, mirroring
   investigator/verifier — but as a passthrough (`return None`) for non-empty responses, since
   proofreaders return plain prose and must **not** be run through `json.loads`.
8. **Frontend** — only a proposal that actually passes validation (`success === true`) becomes
   the draft auto-opened in the right drawer when a turn ends, so a rejected proposal no longer
   clobbers a good one; and every proposal shows its version number ("第 N 版") on both the chat
   chip and the drawer, numbered by the same submission order `[[draft:vN]]` resolves against, so
   a human asking to revisit "version 3" means what the writer will resolve.

### Consequences

- Good, because the failure class is closed at its source: the sub-agent receives the actual
  text, never a dangling reference — and because expansion happens at dispatch, the Langfuse
  trace records the fully expanded request, so what the sub-agent really saw is auditable.
- Good, because the writer keeps the cheap reference it wanted (a short symbol) while every
  parallel call still gets the full content, and it stays free to send a message-only call
  without a draft.
- Good, because "any version" comes for free — each proposal is already its own event, so
  `[[draft:vN]]` needs no version store — and because the frontend and backend number versions
  from the same ordering, so the human and the writer mean the same "version N".
- Good, because zero session-state writes means zero `list_sessions` cost and no interaction with
  the sidebar payload, and because the event history is reached through a public ADK property.
- Good, because the draft tool's validation gate stopped being pure friction and became the
  revision signal of the review loop.
- Bad, because the mechanism is **opt-in**: the writer can omit a symbol and still ship a
  dangling reference. This is mitigated, not eliminated, by the report-back protocol (which also
  catches unrelated drift) — the two are deliberately paired, and report-back must not be dropped
  as redundant.
- Bad, because expansion couples us to the shape of ADK events and `google.genai` parts
  (iterating `session.events` for `function_call` / `function_response`); a unit test pins the
  behaviour so an ADK upgrade fails loudly instead of silently.
- Bad, because `[[…]]` is a bespoke convention that exists only to avoid a collision with ADK's
  own templating, and it must be kept out of instruction strings.
- Bad, because a session can now contain several `draft_factcheck_response` calls, so "the draft"
  is no longer unambiguous — anything reading drafts back (the drawer, future exports) has to
  choose a version deliberately.
- Neutral: **this does not save tokens.** An early justification claimed it removes a 4× draft
  repetition; that was wrong — the draft was already emitted once (one full copy plus three
  placeholders), which is precisely why three proofreaders starved. The real gain is correctness;
  token cost is roughly unchanged, and the saving is only relative to the naive-correct
  alternative of pasting the draft into all four requests.

## Confirmation

- Unit tests in `adk/cofacts_ai/tests/test_writer_symbols.py` cover `expand_writer_symbols`:
  latest-draft and `[[draft:vN]]` selection (asserting `v1` is the _first_ proposal), a
  gate-rejected proposal still resolving, `[[message]]` from the article response, multi-article
  resolution (bare = most recent, `[[message:<id>]]` addressing a specific one, a re-fetch
  becoming most recent, an unknown id listing what is available, an error response never
  resolving), both symbols
  in one request, an unresolved symbol becoming a `[SYSTEM: …]` marker, the tool-name gate
  skipping non-sub-agent tools, and the proofreader `after_tool` branch (empty/`None` → retry
  dict; non-JSON prose → passthrough without parsing).
- Frontend tests in `src/lib/__tests__/chatCache.test.ts` cover the auto-open gating (a rejected
  proposal never becomes `lastReplyDraftId`, and never clobbers a prior successful one) and
  version numbering across messages.
- CI: `ruff format`/`ruff check`/`ty` and pytest for `adk/`; ESLint/Prettier/`tsc` and vitest for
  the frontend.
- An adversarial fresh-context review of the whole diff confirmed each claim above, including
  that `draft_factcheck_response`'s validation gate is logically byte-for-byte unchanged.
- Still open: a live end-to-end smoke test of a review round — all four proofreaders receiving
  the draft via `[[draft]]`, and report-back firing when a symbol is omitted.

## More Information

- Issue [cofacts/ai#117](https://github.com/cofacts/ai/issues/117) — the trace analysis, the
  frequency sampling, and the original report-back proposal; its comments contain the parallel
  fan-out mechanism and a correction of which option the issue itself proposed.
- PR [cofacts/ai#119](https://github.com/cofacts/ai/pull/119) — implementation.
- Background research: 《資訊偏聽型 Proofreader：媒體環境模擬與動態記憶之設計研究》 §2.3 in
  [cofacts/kb#10](https://github.com/cofacts/kb/pull/10).
- The draft tool's per-claim coverage gate — reused here as review feedback — is
  [`20260515-agent-source-integrity-contract`](20260515-agent-source-integrity-contract.md),
  which also documents why the sub-agents are `AgentTool`-wrapped in the first place (built-in
  tools cannot share an agent with function tools) — the constraint that makes their sessions
  stateless and this decision necessary.
- If the opt-in weakness ever proves too leaky in practice, the fallback is the runner-up:
  `temp:` state written by the draft tool plus `{temp:draft_for_review?}` in the proofreader
  instructions, which trades the writer's control for a guarantee it can never omit — see the
  ADK facts above for the ordering constraint that approach carries.
