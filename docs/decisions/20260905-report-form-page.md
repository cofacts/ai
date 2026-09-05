---
status: 'accepted'
date: 2026-09-05
decision-makers: mrorz
consulted: Cofacts working group, Cofacts designer
---

# Report a suspicious message through a form, not a conversation

## Context and Problem Statement

Cofacts' LINE bot has seen a long decline in queries without a matching decline in newly
reported messages: generative AI now answers "is this true?" on the spot, but nothing answers
"I saw something strange and want people to know it is circulating". The strategy that follows
is to make cofacts.ai a place to **report**, not only a place to check — it is the only front
end still under active development that already has login, a chat UI, and access to the Cofacts
database.

The blocker was `ai_writer`. As the root agent its prompt opens with "Users should ALWAYS
provide a Cofacts suspicious message URL", so pasting a Threads link got the user told to go
find an article on cofacts.tw first.

Scope: frontend + BFF only (`src/`). No agent (`adk/`) change — see below for why that turns
out to be the point rather than an omission.

## Decision Drivers

- Everything filed through this path becomes a public database record, and the mailbox shows
  who walks into an open text box: refund requests, fraud victims, takedown demands — traffic
  that arrives carrying names, phone numbers and order numbers.
- Do not degrade the fact-checking quality already achieved in `ai_writer`.
- A reported message has to be findable, or reporting it makes the database worse rather than
  better.
- Whatever sits in front of every message is paid for on every message.

## Considered Options

- **A. A receptionist agent in front of the writer**, running the search / pick / +1 flow in
  chat (implemented in [#130](https://github.com/cofacts/ai/pull/130)).
- **B. A standalone mechanical form page**, with a button to the AI at the end.

## Decision Outcome

Chosen option: **B**, from the designer's manuscript for the flow.

The argument that settled it is one Cofacts had already written down in its own design doc,
about takedown requests, without applying it to reporting: **a form is the right container for
personal data, a chat box is not.** A form shows exactly what will be submitted, and there is no
model in between deciding what the user meant.

B also turns out to remove the need for the agent layer entirely rather than merely bypassing
it. The AI is now reachable only from the outcome screen, and that button always carries a
Cofacts article URL — so `ai_writer`'s existing entry contract is not an obstacle to route
around, it is exactly right. With it go `propose_article_submission`, the
`LongRunningFunctionTool` human-in-the-loop design, the flattening of one agent's tool results
into another's context, and the intent-vs-URL judgement for handing a conversation back: four of
the hardest things in option A to verify, none of which now exist.

A receptionist becomes worth building again only if cofacts.ai ever opens a free-text entry
point that is not this form.

### A report must come with a link

`ArticleReferenceInput` has only `LINE | URL`, so a Threads or WhatsApp forward filed without a
link can only be labelled `LINE`, overstating how much of Cofacts came from LINE. Requiring a
link removes that problem at this entry point instead of waiting for a new enum value.

It is also an anti-abuse property, which is the better reason: a public link is what lets
somebody other than the reporter confirm the message is really circulating. Nothing can be
conjured into the database from memory. The cost is real and stated on the page: a pure LINE
forward with no link cannot be reported here, and is sent to the LINE bot, which can take it.

### Searching a bare link needs a different threshold from searching prose

Sharing a Facebook post from Android arrives as `?text=<the link>` and nothing else — measured
on a preview deployment — so a submission with no prose of the user's own is the normal case.
rumors-api's `minimumShouldMatch` default of `10<70%` is tuned for prose: a URL tokenises into
`https`, `www`, `facebook`, `com`, `share` and one unique id, and every Facebook link shares all
but the last of those. Measured against `dev-api.cofacts.tw`:

| query                              | minimumShouldMatch | result                                             |
| ---------------------------------- | ------------------ | -------------------------------------------------- |
| share link **not** in the database | default            | **54 unrelated Facebook posts**, all scoring 225.5 |
| share link **not** in the database | 90%                | 0                                                  |
| share link **in** the database     | 90%                | exactly 1, the right one                           |
| share link **in** the database     | 80%                | 50                                                 |
| prose                              | default            | 1, the right one                                   |

So the threshold switches on whether the submission is links only. A candidate list of
confident-looking noise is worse than an empty one, because it invites the reporter to +1 a
stranger's unrelated message.

This is worth knowing about `ListArticles(moreLikeThis:)` generally: it already resolves the
URLs in the query through url-resolver, folds the resulting title/summary into the `like` set,
searches `hyperlinks.title/summary` as well as `text`, and separately matches the resolved URL —
canonical form included — against other articles' hyperlinks. None of that rescues a link it
cannot resolve, which is why the threshold still has to change.

### Consequences

- Good, because the reporting path feeds Cofacts' existing popularity signal directly:
  `CreateOrUpdateReplyRequest` is create-or-_update_ per user, so a repeat +1 cannot inflate the
  count. `CreateArticle` upserts on `xxhash64(text)`, so a double submit cannot duplicate.
- Good, because `reference` is always `{URL, permalink}` — this entry point never has to
  mislabel a source.
- Good, because no agent changes: the fact-checking pipeline is untouched by a feature that
  doubles what the product does.
- **Bad, because nothing checks for personal data before a write reaches the public database.**
  Option A put an LLM in front of that write; a form does not, and the decision here was to ship
  a static warning rather than mechanical rejection, on the grounds that a false positive blocks
  a real report. This is a knowing downgrade at the one point where content actually becomes
  public, and it should be revisited with real submissions in hand.
- Bad, because the same post reported twice under two URL forms (a share link and an address-bar
  link) is two articles. Search finds both, so a reporter who reads the candidate list will pick
  the existing one; only "都不是" splits them.
- Neutral, because attachments are not accepted yet. `CreateMediaArticle` needs a URL rumors-api
  can fetch, and cofacts.ai's upload path produces only a private artifact.

## Confirmation

- `src/server/__tests__/report.queries.test.ts` covers all four Cofacts calls, including the
  threshold switch, the signed-out refusal that never reaches the API, and `reference` always
  being `URL`.
- `src/server/__tests__/cofactsSite.test.ts` covers deriving the site host from the API host —
  every deployment points at `dev-api.cofacts.tw`, so a `cofacts.tw` link would 404.
- `src/lib/__tests__/report.test.ts` covers the share-sheet payload shapes, including the real
  Facebook-on-Android one, and the link-required predicate.
- The manifest, the icon links and the four icon files were checked against a running dev
  server, not just read.
- Not covered by tests: the outcome screens themselves. This repo has no React component test
  harness, and standing one up was out of scope here.

## More Information

- Driving design doc: 可疑訊息回報：cofacts.ai 作為回報入口 in
  [cofacts/kb](https://github.com/cofacts/kb/pull/16) — background, the mailbox categories
  A–H, the `reference` enum gap (§6.3), LINE-bot drainage (§9) and the heat-metric analysis
  (§10). It describes the conversational flow (option A), which this record supersedes for the
  reporting path.
- Option A as built: [#130](https://github.com/cofacts/ai/pull/130), which carries its own
  decision record on that branch. Nothing is superseded here, because it never landed on
  `master`.
- Revisit when: attachments are added (needs an upload with a fetchable URL); real submissions
  show what the missing personal-data check actually costs; or a free-text entry point is opened
  that this form does not cover.
