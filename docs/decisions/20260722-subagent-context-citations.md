---
status: 'accepted'
date: 2026-07-22
decision-makers: [MrOrz]
consulted:
informed:
---

# Cite tool results by footnote id in stateless sub-agent calls

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
the response payload of **every** writer tool, callbacks in `adk/cofacts_ai/agent.py` and the new
`writer_citations.py`, the `draft_factcheck_response` contract in `tools.py` — plus the frontend
tool-response types (`src/lib/adk.ts`) and the draft drawer (`src/lib/chatCache.ts`).
Driving issue: [cofacts/ai#117](https://github.com/cofacts/ai/issues/117); implemented in
[cofacts/ai#119](https://github.com/cofacts/ai/pull/119).

This record was revised twice before merging, each time driven by a live trace: the first
implementation used inline symbol substitution (`[[message]]` / `[[draft]]`), which trace
`01d4bc4f` showed was the wrong operation; and citations originally reported an unresolvable id
downstream, which trace `65a3975e` showed has to cancel the call instead. The history is kept in
"Considered Options" and "Decision Outcome" rather than split into superseding records, because
nothing ever shipped to production.

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
- [Trace `01d4bc4f`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/01d4bc4fe799344a0b083b13e7d1b918)
  (2026-07-27) — the first live run of the shipped symbol mechanism. Substitution worked, and
  broke three ways at once. (a) The suspicious message was a bare YouTube link, so the claim
  inventory existed only in an `ai_verifier` response — for which there was no symbol — and the
  writer fell back to re-narrating it from memory, the exact drift this record exists to remove.
  (b) The writer placed `[[message]]` mid-sentence; harmless for a one-line link, but it means a
  long rumor would be spliced into the middle of an instruction. (c) It wrote
  `[[message]][[draft]]` adjacently, and the expansion had no boundary between the rumor and the
  reply under review. Analysis: a hand-maintained symbol vocabulary can only cover content we
  anticipated, and substitution is the wrong operation — the writer is _citing_, not
  _interpolating_.
- [Trace `65a3975e`](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/65a3975e59ba3cdf2788b7a33cbd5fa7)
  (2026-07-27) — the first live run of citations. It worked, and exposed one more failure mode.
  `[^verifier-ygxikp]` reported "matches no tool result" even though that verifier call plainly
  existed and the id was genuinely minted: the writer had issued **the verifier and all four
  proofreaders in one turn** and cited its own sibling. Gemini emits all five calls in a single
  completion, so it already knows the id it just assigned — but the sibling's _response_ does not
  exist when the proofreader's `before_tool_callback` runs. Confirmed by the response parts for
  `verifier:ygxikp2o` and the four proofreaders sitting in one `parts` array. Only the first
  fan-out did this; later rounds cited results already in hand and resolved.

  Cost: the request went out with a `[SYSTEM: …]` note where the claim inventory belonged, and all
  four proofreaders correctly refused via the report-back protocol. The safety net worked, but it
  fired after four sub-agent calls. Analysis: this is #117's original instinct — de-duplicating
  across siblings — and it is the one thing citations cannot serve, so it has to be _rejected_,
  not merely reported downstream. (Incidental finding: Gemini supplies its own call ids here — 8
  base36-ish characters, not the `adk-<uuid4>` ADK generates only when the model omits one. Both
  halves derive from the same field so either shape works, but the id-length cap was written for
  the uuid case and had been discarding two characters of every real id; it is now 8.)

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
- (Added after trace `01d4bc4f`.) Anything the writer might need to forward must be referenceable,
  not just the contents we thought of in advance; the sub-agent must be able to tell one piece of
  forwarded content from another; and where the writer happens to put a reference must not change
  what the sub-agent receives.

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
- **LLM-written symbols expanded inline from the writer's event history** (`[[message]]`,
  `[[draft]]`, `[[draft:vN]]`), with `draft_factcheck_response` itself as the draft anchor.
  Implemented first, then revised after trace `01d4bc4f`.
- **A `set_symbol(name, content)` tool** letting the writer define its own named text for reuse
  across a fan-out.
- **Footnote citations of tool results, hoisted into labelled blocks.** **Chosen.**

## Decision Outcome

Chosen option: **every tool result hands the writer a footnote id; writing `[^id]` in a
sub-agent's `request` hoists that result's full text to the top of the request as a block tagged
with the same id** — because it is the only option where the _writer decides_ what each call must
see (the requirement no mechanical rule can satisfy), content is _never retyped_, _any_ result
stays referenceable, and nothing is written to session state at all, so `list_sessions` is
untouched. The content already exists in the event history; copying it into state would duplicate
data purely to hand it back.

The other options were rejected, or kept in a smaller role:

- **Inline symbol substitution** was implemented first and revised after one live trace. Three
  faults, all traceable to substituting rather than citing: a fixed vocabulary
  (`[[message]]`/`[[draft]]`) could not name a verifier report, so the writer paraphrased it;
  content landed wherever the writer put the symbol, mid-sentence included; and adjacent symbols
  expanded into one undifferentiated blob. Citing fixes all three at once — the id comes from the
  result rather than from a vocabulary, and the definition is a delimited block in a fixed place.
- **`set_symbol(name, content)`** would let the writer define arbitrary reusable text, which is
  strictly more general. Rejected because it does not solve the problem that prompted it: the
  writer has to _type_ the content, so what the sub-agents receive is still a re-narration —
  the drift this record exists to remove, now wearing the costume of correct usage. It would also
  need its own "call it in an earlier turn" rule (parallel calls cannot see each other), a new
  entry in `src/lib/adk.ts`, and a UI chip for what is effectively a variable assignment. Worth
  revisiting only if traces show the writer wanting to reuse text that has no tool-call anchor.

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
  weakness of an opt-in mechanism: the writer can forget to cite anything at all.

As shipped in PR #119, in `adk/cofacts_ai/writer_citations.py` (its own module, following
`media_filedata.py`) — minting and resolution live together so the two halves cannot drift:

1. **`attach_citation`, called from `after_tool` for every tool.** It stamps the response with
   `cite_as` (the exact string to type, e.g. `[^verifier-ygxikp2o]`) and a one-line `cite_hint`.
   The id is the tool name plus the call id, with the `adk-` prefix and any punctuation dropped and
   the remainder capped at 8 characters — **one formula, no per-tool branching**. Three properties
   fall out of deriving it from the call id: calls issued in parallel cannot collide (counting them
   would); the call and its response share the id, so a citation can resolve to content on either
   side; and the tool name in front keeps it legible, which matters because citing the wrong id
   resolves _successfully_ to the wrong content — a silent failure, worse than not resolving.
   Error payloads are not stamped.

   Gemini issues its own 8-character call ids, which the cap therefore keeps whole. It exists for
   ADK's fallback: when the model supplies no id, `populate_client_function_call_id` generates
   `adk-<uuid4>`, and asking the writer to copy 40 characters invites exactly the mistakes the
   `[SYSTEM: …]` path used to report.

   The id has to travel **inside the payload**: ADK strips its own `adk-…` ids from the history it
   sends to the model (`flows/llm_flows/contents.py`), so this is the writer's only chance to
   learn it.

2. **`resolve_citations`, a `before_tool_callback` on `ai_writer`.** For calls to the six
   `AgentTool` sub-agents it scans `request` once for `[^id]` markers, then rewrites
   `args['request']` in place and returns `None` so the call proceeds. Cited results are **hoisted
   above the prose**, each in its own block, separated from the request by `---`; the marker stays
   where the writer wrote it, exactly as a footnote marker does.

   Hoisting is the fix for two of the three faults trace `01d4bc4f` exposed: a long rumor is never
   spliced into the middle of an instruction, and where the writer puts a marker no longer changes
   what the sub-agent receives. Blocks are emitted in the order the underlying results occurred,
   which yields 原文 → 查證 → 草稿 in the normal flow without any type-ranking rule, and a result
   cited twice produces one block.

3. **The citation id is the block's tag name** — `<verifier-ygxikp2o>…</verifier-ygxikp2o>`, no `ref`
   attribute and no per-tool tag vocabulary to maintain. The marker and both delimiters are the
   same string, which is the strongest join available, and it makes the closing delimiter
   unguessable, so untrusted message text cannot break out of its own block (it is escaped as
   well, cheaply). The cost is that a sub-agent sees provenance rather than meaning
   (`<get_single_cofacts_article-…>`, not `<suspicious_message>`); acceptable, since the tool names
   are descriptive and the writer's prose supplies the framing.

   The **marker** syntax is GitHub-flavored markdown's footnote form, `[^id]`. Its _definition_
   form (`[^id]: …`) is not used: GFM requires every continuation line of a footnote definition to
   be indented, which would rewrite a multi-paragraph rumor — the same objection that ruled out
   blockquotes. Square-bracket syntax also sidesteps ADK's instruction templating, which would
   parse a curly-brace symbol in the writer's own instruction as a state reference and raise
   `KeyError` while rendering it.

4. **Minting is uniform; body extraction is not.** A small table decides which field of each
   response becomes the block body, with a compact-JSON fallback for unlisted tools. The
   article-specific entry matters: dumping the whole `get_single_cofacts_article` payload would
   hand a proofreader the existing fact-check responses and reply counts — other people's verdicts
   on the very thing we are asking it to judge. `draft_factcheck_response` is the one tool read
   from its **call** arguments, so a proposal the validation gate **rejected** is still reviewable.

5. **An unresolvable citation cancels the call.** `resolve_citations` returns
   `{"error": "unresolved_citation", "message": …}`, and ADK runs a tool only `if
function_response is None` (`flows/llm_flows/functions.py`), so a truthy return from a
   `before_tool_callback` becomes the response and the sub-agent never runs. `after_tool` still
   runs and leaves error payloads unstamped, so nothing else changes.

   **Any** bad citation cancels the call, even when others resolved: a proofreader handed the draft
   but not the evidence _answers anyway_, and the answer looks legitimate — the exact failure #117
   is about. Failing loudly for the price of one retry beats four sub-agent calls and a dead round.

   The message says which reason applies, from one pass over the event history: the call **has not
   returned yet** (its id is among the calls but not the responses — the same-turn sibling case);
   it **returned an error** (id among the responses but nothing citable); or **no result has that
   id**, listing what does. The first is worth distinguishing precisely because "no such id" would
   send the writer hunting for a typo instead of splitting the turn.

   This is the same-turn constraint the parallel-delta ADK finding predicted, now observed for
   event history rather than session state: **a citation can only address a result from an earlier
   turn.** The writer's instruction states that rule, and Steps 3/7 say research finishes in one
   turn and the proofreader fan-out happens in the next.

   Hoisted text is never rescanned, so a citation-shaped string inside a rumor or a draft stays
   literal.

6. **`draft_factcheck_response` reframed from a one-shot final action into a re-callable draft
   proposal** (docstring, writer instruction, and success message only — **the validation logic
   is unchanged**). Its Steps 6/7 became a propose → cite-and-review → revise loop. It keeps the
   pre-existing "call it alone, never in the same turn as another tool" rule, which now also
   guarantees a proposal is committed to the event history before any later citation resolves
   against it — the ordering constraint the parallel-delta finding demands, satisfied by a rule
   that already existed.
7. **A report-back protocol in all four proofreader instructions**: every call is a fresh
   conversation; if the request references something you cannot see, do not answer or guess —
   reply that you did not receive the full content and ask for it. All six sub-agent instructions
   also explain the `[^id]` / `<id>…</id>` pairing so a block is never mistaken for stray markup.
8. **The dead "Control Flow — transfer back to the main AI Writer" block removed** from all four
   proofreaders. An `AgentTool` child runs in an isolated runner with no `transfer_to_agent`
   tool, so the instruction was unreachable, and a model told to perform a transfer it cannot
   perform is a plausible source of the empty-output (`None`) traces.
9. **Empty-response retry extended to proofreaders** in `after_tool`, mirroring
   investigator/verifier. Proofreaders return plain prose and must **not** be run through
   `json.loads`; the prose is preserved verbatim under `result`, which is how ADK would have
   wrapped it anyway, plus the citation fields.
10. **Frontend** — only a proposal that actually passes validation (`success === true`) becomes
    the draft auto-opened in the right drawer when a turn ends, so a rejected proposal no longer
    clobbers a good one. `cite_as` / `cite_hint` are added to every response type in
    `src/lib/adk.ts` as **optional** fields, because sessions recorded before this change have
    neither and error payloads are never stamped.

    An earlier iteration also numbered each proposal ("第 N 版") on the chip and in the drawer.
    That was dropped: users refer to drafts naturally (「前一版」、「寫著 OOO 那一版」) and the
    writer can map that onto the right id from its own history, so the counter bought nothing the
    conversation did not already provide — at the cost of an ordinal threaded through eight
    frontend files.

### Consequences

- Good, because the failure class is closed at its source: the sub-agent receives the actual
  text, never a dangling reference — and because resolution happens at dispatch, the Langfuse
  trace records the fully resolved request, so what the sub-agent really saw is auditable.
- Good, because the writer keeps the cheap reference it wanted (a short marker) while every
  parallel call still gets the full content, and it stays free to send a message-only call
  without a draft.
- Good, because **the writer never constructs a reference** — it only ever copies an id a tool
  result just handed it. There is no vocabulary to remember, no numbering rule to get wrong, and
  the teaching (`cite_hint`) arrives at the moment there is something worth forwarding rather than
  sitting hundreds of lines up in the system instruction.
- Good, because coverage is now open-ended: anything a tool returns is citable, including the
  verifier reports whose absence caused the paraphrase in trace `01d4bc4f`. "Any version" of the
  draft also comes for free, since each proposal is already its own event.
- Good, because zero session-state writes means zero `list_sessions` cost and no interaction with
  the sidebar payload, and because the event history is reached through a public ADK property.
- Good, because the draft tool's validation gate stopped being pure friction and became the
  revision signal of the review loop.
- Good, because a _wrong_ citation is now cheap: the call is cancelled before any sub-agent runs,
  and the writer gets a reason it can act on. Trace `65a3975e` cost four proofreader calls and a
  review round to surface one bad id.
- Bad, because the mechanism is still **opt-in**: the writer can omit a citation entirely and ship
  a dangling reference in prose, which cancellation cannot catch. This is mitigated, not
  eliminated, by the report-back protocol (which also catches unrelated drift) — the two are
  deliberately paired, and report-back must not be dropped as redundant.
- Bad, because cancellation depends on ADK's "run the tool only if the callback returned nothing"
  contract. It is stable and documented, but it is load-bearing here rather than incidental.
- Bad, because there is no automatic "latest" any more: citing an older draft after producing a
  newer one is possible, and it resolves silently. Recency is the mitigation — the fresh
  `cite_as` is the last thing the writer reads before the proofreader fan-out — plus an explicit
  instruction in Step 7.
- Bad, because resolution couples us to the shape of ADK events and `google.genai` parts
  (iterating `session.events` for `function_call` / `function_response`, and relying on a response
  carrying its call's id); unit tests pin the behaviour so an ADK upgrade fails loudly instead of
  silently.
- Bad, because every tool response now carries two extra fields, so `src/lib/adk.ts` has to stay
  in sync and consumers must treat them as optional.
- Bad, because a session can now contain several `draft_factcheck_response` calls, so "the draft"
  is no longer unambiguous — anything reading drafts back (the drawer, future exports) has to
  choose deliberately.
- Neutral: **this does not save tokens.** An early justification claimed it removes a 4× draft
  repetition; that was wrong — the draft was already emitted once (one full copy plus three
  placeholders), which is precisely why three proofreaders starved. The real gain is correctness;
  token cost is roughly unchanged, and the saving is only relative to the naive-correct
  alternative of pasting the draft into all four requests.

## Confirmation

- Unit tests in `adk/cofacts_ai/tests/test_writer_citations.py` cover both halves: minting
  (distinct ids for two parallel calls to the same tool, error payloads and id-less calls left
  alone, a plain string wrapped the way ADK would) and resolution (hoisting above the prose,
  chronological block order regardless of citation order, one block for a doubly-cited id, the
  draft resolving from its **call** args so a gate-rejected proposal still works, a verifier
  report and a proofreader's feedback both citable, a compact-JSON fallback for unlisted tools, an
  hoisted content never rescanned, a forged closing tag escaped, and a pre-citation-era response
  still resolving). One test round-trips `attach_citation` into `resolve_citations` so the two
  halves cannot silently disagree. A separate class covers cancellation: a same-turn sibling
  citation returns the "has not returned yet" error and leaves `args` untouched, an errored result
  and an unknown id give their own reasons, every bad id is reported rather than just the first,
  and one bad citation cancels the call even when others resolved.
- `adk/cofacts_ai/tests/test_writer_callbacks.py` covers the `after_tool` routing: every response
  shape emerges stamped; timeout errors and a cancelled call emerge unstamped.
- Frontend tests in `src/lib/__tests__/chatCache.test.ts` cover the auto-open gating (a rejected
  proposal never becomes `lastReplyDraftId`, and never clobbers a prior successful one).
- CI: `ruff format`/`ruff check`/`ty` and pytest for `adk/`; ESLint/Prettier/`tsc` and vitest for
  the frontend.
- An adversarial fresh-context review of the whole diff confirmed each claim above, including
  that `draft_factcheck_response`'s validation gate is logically byte-for-byte unchanged.
- Trace `65a3975e` confirmed the mechanism live: the writer cited the article, the investigator
  findings and its drafts, and labelled each citation in its own prose ("Suspicious Message
  (YouTube video): [^…] / Extracted Claims from Video: [^…] / Research Findings: [^…]"). It also
  produced the same-turn failure that cancellation now rejects.
- Still open: a re-run on the same article, checking that no `[SYSTEM: …]` note ever reaches a
  sub-agent, that a same-turn citation is cancelled and the next turn's retry resolves, and that
  no proofreader returns the 「我沒有收到完整的內容」 refusal. This mechanism is being iterated
  trace-first: `01d4bc4f` replaced the first shape, `65a3975e` added cancellation.

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
