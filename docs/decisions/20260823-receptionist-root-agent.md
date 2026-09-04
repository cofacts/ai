---
status: 'accepted'
date: 2026-08-23
decision-makers: mrorz
consulted: Cofacts working group
---

# A receptionist agent in front of the writer, so cofacts.ai can take reports

## Context and Problem Statement

Cofacts' LINE bot has seen a long decline in queries without a matching decline in newly
reported messages: generative AI now answers "is this true?" on the spot, but nothing answers
"I saw something strange and want people to know it is circulating". The strategy that follows
is to make cofacts.ai a place to **report**, not only a place to check — and cofacts.ai is the
only front end still under active development that already has login, a chat UI, and access to
the Cofacts database.

The blocker was `ai_writer` itself. As the root agent its prompt opened with "Users should
ALWAYS provide a Cofacts suspicious message URL", so pasting a Threads link or a forwarded
message got the user told to go find an article on cofacts.tw. Meanwhile that prompt is long and
tuned over many production traces (orchestration discipline, the citation mechanism, the
per-claim source-coverage gate), and Cofacts' inbox shows that an open text box also attracts
refund requests, fraud victims, and takedown demands — traffic that arrives carrying personal
data. Folding intake and a support desk into the writer's prompt risked the fact-checking
pipeline that already works.

Scope: ADK agents (`adk/`) and the frontend tool contract (`src/lib/adk.ts`). Driving design
doc: 可疑訊息回報：cofacts.ai 作為回報入口 in
[cofacts/kb](https://github.com/cofacts/kb/blob/master/src/technical-design/cofacts.ai/) (§4),
milestone M1.

## Decision Drivers

- Do not degrade the fact-checking quality already achieved in `ai_writer`.
- A user must be able to paste a bare link or bare text and get somewhere useful.
- Non-fact-check visitors must be routed, and their personal data must not be echoed or stored.
- A session is a workspace: users send follow-up and variant messages, and the research already
  done in that session should stay reusable.
- Cost: whatever sits in front of every message is paid for on every message.

## Considered Options

- **A. Extend `ai_writer`'s prompt and give it intake tools.**
- **B. A new root agent with `ai_writer` as a `sub_agent`** (ADK auto-flow `transfer_to_agent`).
- **C. A new root agent with `ai_writer` wrapped as an `AgentTool`.**

## Decision Outcome

Chosen option: **B**. `ai_receptionist` becomes the root agent, `ai_writer` becomes its only
sub-agent, and control moves between them via ADK's `transfer_to_agent`.

C is not viable: an `AgentTool` call is a fresh, stateless, single-message session, so the
writer would lose multi-turn conversation entirely — the thing a fact-check is made of. A keeps
one LLM call per message but puts the intake rules, the support-desk persona and the
fact-checking pipeline in one prompt, which is exactly the dilution we are trying to avoid.

B costs one extra LLM call, and only on the messages the receptionist actually handles — see
"transfer is one-way in practice" below. It runs on `gemini-3.1-flash-lite` at `LOW` thinking,
since classifying intent and taking a report is not frontier work.

### `disallow_transfer_to_parent` stays False on both agents

This single default does two separate jobs, and setting it to `True` would silently cost both:

1. **The writer can hand a new suspicious message back.** Users send variant messages mid-check,
   and a variant may not be in Cofacts yet. Without the return path they would have to open a new
   session and lose the verifier reports and investigator findings already in this one — which
   `writer_citations.resolve_citations` reads out of the session's own event history.
2. **Transfer is one-way in practice.** `Runner._find_agent_to_run` scans events in reverse and
   resumes at the last agent that replied, but only if `_is_transferable_across_agent_tree` holds
   for it — which walks up the tree checking exactly this flag. With the default, later turns
   resume straight at the writer and a fact-check does not pay for a receptionist turn per
   message. With `True`, every turn would fall back to the root.

The trigger for transferring back is written as **intent, not URL pattern**. Users constantly
paste non-cofacts.tw URLs as _evidence_ during a check; a pattern rule would shovel their own
sources into the reporting flow. The writer's prompt states the distinction and is told to ask
rather than guess.

### Where the two turn-level callbacks live

`update_last_event_time` runs on **both** agents; `generate_session_title` runs on the **root
only**. The asymmetry follows from ADK, and getting it wrong is silent:

- `BaseAgent.run_async` only runs an agent's `after_agent_callback` if that agent ran. Once the
  receptionist has transferred, later turns resume at the writer and the root never runs — so a
  root-only `update_last_event_time` would stop updating `lastEventTime` for the rest of the
  fact-check, breaking sidebar ordering and the unread dot.
- The reverse for the title: it only ever acts on the first turn, and the first turn always runs
  at the root (there are no prior events for `_find_agent_to_run` to resume from). Mounting it on
  the writer too would fire it twice on a transferring turn — the writer runs nested inside the
  root's `_run_async_impl`, so both callbacks fire for one user message — and spend a second LLM
  call overwriting the first title.

Note that `state["title"]` cannot be used as the "already done" marker: the frontend seeds it
with the user's truncated first message at session creation, so it is always truthy.

### The receptionist gets its own lean search tool

`search_suspicious_messages` returns only `{id, text (truncated), articleType, createdAt,
factCheckCount, communityDemandCount}` rather than reusing `search_cofacts_database`, which
selects the full `COMMON_ARTICLE_FIELDS` fragment (existing replies, 90 days of stats, related
articles) for up to 10 hits.

The reason is a property of ADK we had to discover: after a transfer, the writer does not see
another agent's tool results as tool results. `contents._present_other_agent_message` flattens
them into a plain `user`-role text part — ``[receptionist] `tool` returned result: {...}``. So a
full search payload would be pasted verbatim into the writer's context. The same flattening has
a second consequence: an article the receptionist fetched arrives without its media
(`inject_article_attachment` matches on `function_response` parts) and without a `cite_as`, so
**the writer re-fetches the article itself** as its first action.

The writer's prompt states that rule bare, with no explanation of what its context does or does
not already contain. The first version explained it — "even when `ai_receptionist` already looked
it up ... an article it fetched arrives as a paraphrase of a payload" — and that explanation was
false on the path that matters most. On the article-URL path the receptionist transfers on sight
and looks nothing up, so the writer's context holds only the URL and two flattened
`transfer_to_agent` lines; the prompt nonetheless told it a paraphrased article was already in
front of it. Langfuse sessions `30c968c2-0d8f-4a75-a4d4-6be3a7fb3df2` and
`fc367737-0572-4b5e-b0a5-496dbe1aac59` show what that cost: on its very first turn the writer
wrote out the hand-off the prompt had promised — "I've already looked it up for you", "I've
handed this over to our writer agent" — around a chain message it invented, then trusted its own
invention over the real payload and researched, verified, proofread and drafted a reply to it,
while the actual article was a YouTube video about food. The lesson is narrower than the prompt:
tell an agent what to do, not what its context contains.

### Consequences

- Good, because `ai_writer`'s prompt keeps its focus; the intake and support-desk rules live in
  a separate file (`receptionist.py`) with a separate persona and a cheaper model.
- Good, because the reporting path feeds Cofacts' existing popularity signal directly:
  `request_fact_check` calls `CreateOrUpdateReplyRequest`, which is create-or-_update_ per user,
  so a repeat +1 cannot inflate the count.
- Bad, because one classification call is added to the messages the receptionist handles.
- Bad, because two agents can now ping-pong. Mitigated by mutually exclusive, intent-based
  triggers and by the receptionist's rule to transfer on sight of an article URL without
  commentary; not yet mitigated by a hard transfer counter.
- Neutral, because M1 deliberately cannot write a _new_ article. When nothing matches, the
  receptionist says so plainly and points at the LINE bot. Creating articles
  (`propose_article_submission` + a BFF `CreateArticle`, human-in-the-loop) is M2.

## Confirmation

- `adk/cofacts_ai/tests/test_intake_tools.py` covers the two new tools, including the
  signed-out refusal that keeps a write from being attempted without a user.
- `adk/cofacts_ai/tests/test_session_title.py` covers a first turn the receptionist handled
  alone, and that the seeded placeholder title does not suppress generation.
- The transfer-resumption claim is executable:
  `Runner._is_transferable_across_agent_tree(ai_writer)` must be `True`.
- Behavioural routing (the three intents, and not echoing personal data) is prompt-level and has
  no unit test; it is checked against Langfuse traces.

## More Information

- Design doc: 可疑訊息回報：cofacts.ai 作為回報入口, cofacts/kb — §4 (agent topology), §5
  (write path), §8 (non-fact-check intents), §10 (why `replyRequestCount` is the signal).
- Supersedes nothing, but changes the topology described in
  [`../index.md`](../index.md), updated alongside this record.
- Revisit when M2 adds article creation: that introduces a human-in-the-loop write path, and the
  design doc's §5.4 (ADK `LongRunningFunctionTool`) is the upgrade path from the plain BFF
  submit chosen for M2.
