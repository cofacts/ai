---
status: 'accepted'
date: 2026-09-05
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

- **`/report`** — the form (01-回報可疑訊息), with uncontrolled inputs. It calls no server:
  submitting navigates to `/report/check` with `url` and `reason` in history state. Each field
  keeps what has been typed as a draft in `sessionStorage` (the shared
  `src/hooks/useSessionStorageDraft.ts`), so a reload or Back from check finds the form as it
  was. The drafts are cleared when the report completes. TanStack Router's `useBlocker` asks before a reload or tab close while the
  form's `FormData` holds any text (`enableBeforeUnload`); in-app navigation is never blocked.
- **`/report/check`** — searches (02, the loading screen, while pending) and shows the candidates.
  `url` and `reason` live in history state only, never in the URL: they are the reporter's own,
  and a search param would carry them into shared links and logs (for the same reason the
  search server function is a POST: a GET puts its input in the request URL). History state exists only in
  the browser, so the route is `ssr: false`, and its `beforeLoad` redirects to `/report` when the
  state is missing — refresh and Back keep it, a fresh tab or pasted link goes to the form.
  Picking a candidate records a +1 (`CreateOrUpdateReplyRequest`, with the reason) unless it
  already has replies and the reason is blank — a reason typed is never dropped. **Zero results
  files the article at once** (02 → 03-第一個發現他, as in Penpot), as does 都不是. Identical
  messages mirror rumors-line-bot: a candidate whose text equals the link once whitespace is
  removed and the scheme and host are lowercased (both case-insensitive; the path is not) is
  the same message, listed first; 都不是 is then hidden, and a lone identical
  candidate is picked for the reporter. The LINE bot uses string similarity ≥ 0.95, which suits
  prose; for bare links only exact equality is safe, because two links differing by one
  character of a post id are different posts yet score about 0.96 or more. The automatic filing
  and pick act only on the first successful search of this visit (a failure offers 再試一次) and
  replace the check entry, so Back from their outcome goes to the form, now empty. That first
  search decides whether or not it acts: once it has shown candidates, nothing later files or
  +1s for the reporter, and the candidates do not refetch on returning to the tab. After a manual
  pick or 都不是, Back returns to the candidate list; picking again there is harmless, since the
  +1 is per user and `CreateArticle` is idempotent.
- **`/report/$articleId`** — the outcome, read fresh from Cofacts. Check passes what it did as
  `outcome` (`created`, `requested` for a +1, `matched` for no write) in history state, so this
  route is `ssr: false` with the same redirect. It shows 03-有文章且有查核回應 when the article
  has replies, 03-第一個發現他 when `created`, and otherwise 03-有文章但無回應 with the
  article's `replyRequestCount`, saying the +1 was added only for `requested`. From here:
  與 Cofacts AI 討論, the article on cofacts.tw, and 再回報一則 (an empty `/report`).

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
The URL rule — an http(s) link and nothing else — is enforced by the form alone (`type="url"`,
`required`, the http(s) `pattern`). The server functions check only what any caller could get
wrong in shape: text where text is expected, and a non-empty link, since searching or filing
nothing is meaningless (the cofacts-frontend skill's data-layer rule 6). They do not re-check the
URL rule: rumors-api accepts arbitrary text and extracts URLs itself, and any signed-in user can
call it directly with their own token, so a stricter check here would protect nothing. The inline message also points a pure
LINE forward to the LINE bot. It appears when the reporter tries to submit — not on load, while
typing or on blur, where it would move the submit button under a click or tap — and is updated
or cleared while they edit. Pulling a link out of shared text is the Web Share Target's job
([#139](https://github.com/cofacts/ai/pull/139)), not this field's.

### Two thresholds, as in the LINE bot: list loosely, skip the list strictly

rumors-line-bot's `searchText` lists the top 4 of `ListArticles(moreLikeThis:)` at rumors-api's
default `minimumShouldMatch` (`10<70%`), and only skips the list (picks for the user, hides
"none of these") when the top hit's string similarity is ≥ 0.95. This page does the same: the
list uses the default threshold and the top 4, and skipping it takes the exact equality described
under `/report/check` above.

The first version of this page pinned the list itself at 90%, because a bare Facebook share link
nobody had reported returned 54 unrelated Facebook posts on dev at the default (17 on production,
measured 2026-11-11). That broke matching. `moreLikeThis` resolves the URLs in the query through
url-resolver and folds the scraped title and summary into `like` next to the link, so each
`more_like_this` clause (on `text`, and on `hyperlinks.title/summary`) sees terms no single field
of an article holds. From 80% up, nothing matches through them at all, and the only hit left is
the separate exact match of the resolved URL against `hyperlinks.url`. Measured on production:

| query (like)                                        | minimumShouldMatch | result                                                                                      |
| --------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `https://x.com/atensnut/status/2120196706352390258` | 90%, 80%           | only `17374hy10c27j` (same text), score 1: the exact-URL clause                             |
| same                                                | default, 70%       | also `1gz4wbw2dldxz`, the same tweet as `…?a=…&s=46影片`, through its scraped title/summary |
| a Facebook share link not in the database           | 90%, 80%, 75%      | 0                                                                                           |
| same                                                | 70%                | 17 unrelated articles                                                                       |

So at 90% a reporter of the clean link was told nobody had reported it, and a duplicate article
was filed. A missed duplicate is the failure this page exists to prevent; unrelated candidates
are not, as long as the reporter can tell them apart before picking. Each candidate card
therefore shows the title url-resolver scraped for its link, and picking still needs a
deliberate 就是這則.

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
- Bad, because finding the same link depends on rumors-api's `more_like_this` over the page
  content url-resolver scraped. When the linked page is gone — a removed YouTube video, say,
  which returns YouTube's generic description — an exact duplicate can be missed, with unrelated
  messages shown instead or none at all. With none, the automatic filing reuses that article (its
  id is a hash of the text) while the outcome still says 第一個發現他. Fixing that belongs in
  rumors-api / url-resolver, not this form.
- Bad, because reloading in the moment between a successful automatic filing and its navigation
  re-runs the search, auto-picks the reporter's own new article and shows `requested`. The extra
  +1 is the same user's, so it does not double-count.
- Neutral, because attachments are not accepted yet. `CreateMediaArticle` needs a URL rumors-api
  can fetch, and cofacts.ai's upload path produces only a private artifact. A related case —
  a link rumors-api cannot read because of a login wall — is tracked in
  [#148](https://github.com/cofacts/ai/issues/148) as a screenshot upload.

## Confirmation

- `src/routes/report/__tests__/` covers the handlers of the report routes: the search
  using the default threshold, the signed-out refusal that never reaches the API, the reason trimmed to `null`, and
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
