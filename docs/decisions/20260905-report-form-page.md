---
status: 'accepted'
date: 2026-11-06
decision-makers: mrorz
consulted: Cofacts working group, Cofacts designer
---

# Report a suspicious message through a URL-only form

## Context and Problem Statement

Cofacts' LINE bot has seen a long decline in queries without a matching decline in newly
reported messages — an observation from the working group's own
[2026-08-04 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260804.md#cofactsai)
(cofacts/kb): request counts were falling while new-article counts were not, and the meeting's
proposal was exactly this — report suspicious messages through cofacts.ai. That observation
traces back to research in
[Cofacts 擴大社群策略](https://docs.google.com/document/d/1N7224PVdAqGXeQAXUawIfZVF0MkWu-ANyw9W-9Q0OkA/edit).
Generative AI now answers "is this true?" on the spot, but nothing answers "I saw something
strange and want people to know it is circulating". The strategy that follows is to make
cofacts.ai a place to **report**, not only a place to check — it is the only front end still
under active development that already has login, a chat UI, and access to the Cofacts database.

The blocker was `ai_writer`. As the root agent its prompt opens with "Users should ALWAYS
provide a Cofacts suspicious message URL", so pasting a Threads link got the user told to go
find an article on cofacts.tw first.

Scope: frontend + BFF only (`src/`). No agent (`adk/`) change.

### How the design got here

The shape of this decision changed twice, and most of the concerns that shaped the early
proposals no longer apply to what shipped. In order:

1. **Chat, any text.** The first proposal
   ([cofacts/kb#16](https://github.com/cofacts/kb/pull/16), reviewed in the
   [2026-08-18 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260818.md))
   put a receptionist agent in front of the writer, so that a user could paste _any text_ — a
   link or not — into the existing chat. [#130](https://github.com/cofacts/ai/pull/130)
   implemented it.
2. **Form, any text.** Cofacts' designer found that sending the reporter into an AI chat invites
   distraction, and designed a standalone flow instead — in effect the LINE bot's flow as a web
   page ([2026-09-10 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260910.md)).
   Even in chat, a search-result list and a confirm-before-submit step would have needed their
   own UI, so the form costs little extra and is steadier than steering an LLM through the same
   steps. The designer's flow, like the LINE bot's, took the pasted message as text.
3. **Form, URL only.** The message field was narrowed to a single URL before any version of the
   page was committed, so no code or PR history of the text-area form exists — the reasons are
   in [Decision Outcome](#the-form-takes-a-url-and-only-a-url).

Options A and B below are steps 1 and 2; C is what shipped.

## Decision Drivers

- A reported message has to be findable, or reporting it makes the database worse rather than
  better.
- The article's `reference` has to be true. `ArticleReferenceInput` only offers `LINE | URL`.
- Someone other than the reporter should be able to confirm the message is really circulating,
  so nothing can be conjured into the database from memory.
- Cover where messages actually circulate in Taiwan today. Facebook and Threads carry most of
  what the working group sees, and both are reachable by link.
- Everything filed through this path becomes a public database record, so the less free-form
  content a write can carry, the less there is to screen.
- Do not degrade the fact-checking quality already achieved in `ai_writer`, and do not pay for a
  model in front of every message.

## Considered Options

- **A. A receptionist agent in chat, free text in** (kb#16, [#130](https://github.com/cofacts/ai/pull/130)).
- **B. A form that takes free text** — a message text area, with or without a link.
- **C. A form that takes a URL only**, with a button to the AI at the end.

## Decision Outcome

Chosen option: **C**, because it is the only one that satisfies the drivers about
findability, source labelling and verifiability together, and it does so without an agent in
front of the write.

### The form replaces the receptionist

The form is a mechanical flow: search for the link, show candidates, let the reporter pick one
(a +1) or file a new one. It shows exactly what will be submitted, and no model decides what
the user meant.

It also removes the need for the agent layer rather than merely bypassing it. The AI is now
reachable only from the outcome screen, and that button always carries a Cofacts article URL —
so `ai_writer`'s existing entry contract is not an obstacle to route around, it is exactly
right. With it go `propose_article_submission`, the `LongRunningFunctionTool`
human-in-the-loop design, the flattening of one agent's tool results into another's context,
and the intent-vs-URL judgement for handing a conversation back: four of the hardest things in
option A to verify, none of which now exist.

A receptionist becomes worth building again only if cofacts.ai ever opens a free-text entry
point that is not this form.

### Three routes, one per screen

The flow follows the designer's Penpot boards (page "AI"), one route per screen:

- **`/report`** — the form (01-回報可疑訊息). It calls no server: submitting writes `url` and
  `reason` into its own history entry (`replace`), so Back restores the form, then navigates to
  `/report/check` with the same history state.
- **`/report/check`** — searches (02, the loading screen, while pending) and shows the candidates.
  `url` and `reason` live in history state only, never in the URL: they are the reporter's own,
  and a search param would carry them into shared links and logs. History state exists only in
  the browser, so the route is `ssr: false`, and its `beforeLoad` redirects to `/report` when the
  state is missing — refresh and Back keep it, a fresh tab or pasted link goes to the form.
  Picking a candidate nobody has answered records a +1 (`CreateOrUpdateReplyRequest`, with the
  reason); one with replies needs no write. **Zero results files the article at once** (02 →
  03-第一個發現他, as in Penpot), as does 都不是; the automatic filing fires once per visit and
  replaces the check entry, so Back from the outcome returns to the form.
- **`/report/$articleId`** — the outcome, read fresh from Cofacts: 03-有文章且有查核回應 when it has
  replies, 03-第一個發現他 when `?created=true`, otherwise 03-有文章但無回應 with the article's
  `replyRequestCount`. From here: 與 Cofacts AI 討論, the article on cofacts.tw, and 再回報一則 (an
  empty `/report`).

Every logged-out screen shows the sign-in prompt instead (01-回報可疑訊息-未登入). Each route
keeps its server functions inline; the handlers with logic of their own are unit-tested in
`src/routes/report/__tests__/` by mocking `createServerFn`.

### The form takes a URL, and only a URL

1. **Source labelling.** `ArticleReferenceInput` has only `LINE | URL`, so a Threads or
   WhatsApp forward filed without a link can only be labelled `LINE`, overstating how much of
   Cofacts came from LINE. Accepting only a link means `reference` is always `{URL, permalink}`
   at this entry point, without waiting for a new enum value.
2. **Coverage.** A link already reaches Facebook and Threads, the places Taiwan's circulating
   messages gather. The cost is real and stated on the page: a pure LINE forward with no link
   cannot be reported here, and is sent to the LINE bot, which can take it.
3. **Verifiability.** A public link is what lets somebody other than the reporter confirm the
   message is really circulating.
4. **A much smaller surface for the concerns that shaped options A and B.** Those proposals
   were drafted against what the working-group mailbox shows about an open text box: between
   2025-10 and 2026-07 it received refund requests, fraud victims, takedown demands and
   mis-sent screenshots, often carrying names, phone numbers and order numbers (kb#16 §8.1,
   which counted them, and which is why a receptionist and a personal-data check were drafted at
   all). Those people were not sending _messages that circulate_; they were sending _their own
   situation_. A URL field filters for the first kind: what can be pasted is something that was
   already shared publicly, which tends to carry public interest and fact-checking value. Spam
   and personal data do not disappear — see Consequences — but they stop being the central
   risk of the entry point.

How the field behaves: it is a single URL input rather than a text area, because a text area
that quietly kept only the link out of what was pasted would invite exactly the input it was
about to discard. The URL is the article's `text` and its `reference.permalink`
alike, one value that cannot drift, and rumors-api resolves the link at creation to fill in
`hyperlinks.title/summary`, which is what a reader actually sees. The field is a native
`type="url"` input, limited by its `pattern` to an http(s) scheme (in any case) followed by no
whitespace. Words separated from the link by a space are refused; words glued to the link with
no space cannot be told apart from a legitimate non-ASCII path (zh.wikipedia's, say) and pass.
Validation is native only (`type="url"`, `required`, the http(s) `pattern`); the server
functions pass the trimmed text through to rumors-api, which accepts arbitrary text and
extracts URLs itself. The inline message also points a pure
LINE forward to the LINE bot. It appears when the reporter tries to submit — not on load, while
typing or on blur, where it would move the submit button under a click or tap — and is updated
or cleared while they edit. Pulling a link out of shared text is the Web Share Target's job
([#139](https://github.com/cofacts/ai/pull/139)), not this field's.

### Searching a link needs a different threshold from searching prose

Every query from this page is a bare link, and rumors-api's `minimumShouldMatch` default of
`10<70%` is tuned for prose: a URL tokenises into `https`, `www`, `facebook`, `com`, `share` and
one unique id, and every Facebook link shares all but the last of those. Measured against
`dev-api.cofacts.tw`:

| query                              | minimumShouldMatch | result                                             |
| ---------------------------------- | ------------------ | -------------------------------------------------- |
| share link **not** in the database | default            | **54 unrelated Facebook posts**, all scoring 225.5 |
| share link **not** in the database | 90%                | 0                                                  |
| share link **in** the database     | 90%                | exactly 1, the right one                           |
| share link **in** the database     | 80%                | 50                                                 |
| prose                              | default            | 1, the right one                                   |

So the query is pinned at 90%, which asks the question actually being asked — has anyone posted
this same link? A candidate list of confident-looking noise is worse than an empty one, because
it invites the reporter to +1 a stranger's unrelated message.

This is worth knowing about `ListArticles(moreLikeThis:)` generally: it already resolves the
URLs in the query through url-resolver, folds the resulting title/summary into the `like` set,
searches `hyperlinks.title/summary` as well as `text`, and separately matches the resolved URL —
canonical form included — against other articles' hyperlinks. None of that rescues a link it
cannot resolve, which is why the threshold still has to change.

### The reason field uses the LINE bot's wording

「為了協助查證，請告訴闢謠志工：為何您覺得這是謠言？」, with its example placeholder, is taken
verbatim from `ReplyRequestForm` in rumors-line-bot. Cofacts has been asking exactly this
question for years, and its own copy names who reads the answer — which is what gets one
written. The first version of this page paraphrased it and read like an interface explaining
itself.

### Consequences

- Good, because the reporting path feeds Cofacts' existing popularity signal directly:
  `CreateOrUpdateReplyRequest` is create-or-_update_ per user, so a repeat +1 cannot inflate the
  count. `CreateArticle` upserts on `xxhash64(text)`, so a double submit cannot duplicate.
- Good, because `reference` is always `{URL, permalink}` — this entry point never has to
  mislabel a source.
- Good, because no agent changes: the fact-checking pipeline is untouched by a feature that
  doubles what the product does.
- Bad, because **nothing screens a write before it reaches the public database.** Option A
  would have put an LLM in front of that write; the form does not, and it ships a static
  warning (「請不要包含姓名、電話、地址、訂單編號等個人資料」) rather than mechanical rejection,
  because a false positive blocks a real report. Narrowing the input to a link makes this much
  less severe than it was under A and B, but two paths remain:
  - the **reason text area** is free text, and it is public;
  - a **public URL can itself expose personal data**. That is the existing takedown route's
    job, not something this form can see.

  Revisit with real submissions in hand.

- Bad, because a link is cheap to paste: URL-only narrows the input but does not stop a
  logged-in account from filing junk links. Login and the per-user upserts above are the only
  brakes today.
- Bad, because the same post reported twice under two URL forms (a share link and an
  address-bar link) is two articles. Search finds both, so a reporter who reads the candidate
  list will pick the existing one; only "都不是" splits them.
- Neutral, because attachments are not accepted yet. `CreateMediaArticle` needs a URL rumors-api
  can fetch, and cofacts.ai's upload path produces only a private artifact. A related case —
  a link rumors-api cannot read because of a login wall — is tracked in
  [#148](https://github.com/cofacts/ai/issues/148) as a screenshot upload.

## Confirmation

- `src/routes/report/__tests__/` covers the handlers of the report routes: the search
  threshold, the signed-out refusal that never reaches the API, the reason trimmed to `null`, and
  `reference` always being `URL`.
- `src/server/__tests__/cofactsSite.test.ts` covers deriving the site host from the API host —
  every deployment points at `dev-api.cofacts.tw`, so a `cofacts.tw` link would 404.
- Not covered by tests: the outcome screens themselves. This repo has no React component test
  harness, and standing one up was out of scope here.

## Pros and Cons of the Options

### A. A receptionist agent in chat, free text in

- Good, because the reporter stays in one place and the AI can ask follow-up questions.
- Bad, because an LLM has to run search / pick / +1 reliably across turns, which needs
  `propose_article_submission`, a long-running human-in-the-loop tool and cross-agent
  tool-result flattening — hard to verify, and paid for on every message.
- Bad, because an open text box in front of a public database is where the mailbox's
  personal-data traffic would arrive. kb#16 had to add a triage step (eight categories of
  "wrong door" visitors) and a personal-data stop, and noted that anything pasted would
  also land in ADK sessions and Langfuse traces.
- Bad, because the designer found that being taken into an AI chat distracts the reporter.

### B. A form that takes free text

- Good, because it is mechanical and stable, the same flow the LINE bot has used for years.
- Bad, because text without a link cannot be told apart from something made up, and can only
  be labelled `LINE` — the source-labelling problem again.
- Bad, because it keeps the open-text-box exposure of A: the form shows what will be filed, but
  it does not make that content any safer to publish.

### C. A form that takes a URL only

- Good, because every argument under Decision Outcome applies, and there is no agent to build or
  verify.
- Neutral, because it cannot take a pure LINE forward or an attachment; those go to the LINE bot
  or wait for a later change.
- Bad, because the residual risks listed under Consequences remain.

## More Information

- Driving design doc: 可疑訊息回報：cofacts.ai 作為回報入口,
  [cofacts/kb#16](https://github.com/cofacts/kb/pull/16) — **closed, not merged**; MrOrz closed
  it as
  ["superseded by design decision in ai#138"](https://github.com/cofacts/kb/pull/16#issuecomment-5604875201),
  i.e. this record. Its branch still holds the file for reference. Background, the mailbox
  categories A–H (§8.1), the `reference` enum gap (§6.3), LINE-bot drainage (§9) and the
  heat-metric analysis (§10). It describes the conversational flow (option A), which this record
  supersedes for the reporting path. Sourced from the same upstream research and meeting cited
  above.
- Option A as built: [#130](https://github.com/cofacts/ai/pull/130), closed unmerged, which
  carries its own decision record on that branch. Nothing is superseded here, because it never
  landed on `master`.
- Revisit when: attachments are added (needs an upload with a fetchable URL); real submissions
  show what the missing personal-data check actually costs, or how much junk a link field
  attracts; or a free-text entry point is opened that this form does not cover.
