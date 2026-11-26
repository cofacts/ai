---
status: 'proposed'
date: 2026-11-25
decision-makers: [klhq]
consulted:
informed:
---

# Keep list filters in readable, text-parsed URL search params

## Context and Problem Statement

The list pages (/articles, /replies, /hoax-for-you, /search and the user page) keep their
filters in the URL, so a link can be shared and Reload or Back restores the same view. Links to
these pages end up in LINE chats, the LINE bot's replies and search engines, so the URL format
becomes a public contract: once links are out, renaming a param or changing how values are
written breaks them.

TanStack Router's default `parseSearch` runs `JSON.parse` on every value. `?q=12345678901234567890`
reached a page as a rounded number, `?q=1.50` as `1.5` and `?q=%22hi%22` as `hi`, before any
schema could see the original text. Its `stringifySearch` writes strings with JSON quotes and lists
as JSON arrays, which makes links hard to read.

Scope: frontend only, the router setup (`src/router.tsx`, `src/lib/urlSearch.ts`) and the list
pages' search params (`src/lib/search-params/`). Driven by
[#208](https://github.com/cofacts/ai/pull/208), part of
[#183](https://github.com/cofacts/ai/issues/183).

## Decision Drivers

- The kb design doc's URL rules (§2.1): readable values with a whitelist, unknown params
  ignored, bad values fall back to their defaults, no input can crash a page, defaults and empty
  values are not written.
- No compatibility with rumors-site's list params (`filters`, `types`, `orderBy`…), decided
  2026-10-28 in the same doc (§2.3): old bookmarks open the page with its defaults.
- Keyword and id values must reach the page exactly as typed, including number-like text such as
  phone numbers.
- `<Link search>` and `navigate({ search })` should be type-checked against the page's values.
- One place defines each page's params; routes, filter UI and queries read it from there.

## Considered Options

- Router defaults (JSON values) with a schema per page
- Text values and comma-joined lists, with a schema per page (chosen)
- Repeated keys for lists (`?replyType=rumor&replyType=not-rumor`)
- Keep rumors-site's param names and values, or translate old params to new ones

## Decision Outcome

Chosen option: "text values and comma-joined lists, with a schema per page", because it keeps
every value as typed, gives the shortest readable links, and lets each page's schema decide what a
value means.

- `src/lib/urlSearch.ts` replaces the router's `parseSearch` and `stringifySearch`. A value is the
  text in the address bar; a repeated key is read as a list. Lists are written comma-joined with
  the commas unencoded (`replyType=rumor,not-rumor`). Objects have no text form and are left out.
- `src/lib/search-params/` holds one zod schema per page. Every field has a fallback (`.catch`),
  so parsing never throws: a bad value becomes its default, a list keeps its valid items, and
  unknown params are dropped. Values are lower-case kebab-case in the UI's wording (回報 is
  `reported`, 查核 is `replied`); /search keeps rumors-site's `type` and the user page its `tab`.
- Each page exports route options to spread into the route: the schema as `validateSearch`, and
  `stripSearchParams` with the page's defaults, so links built from `useSearch()` carry only what
  changed.
- The schemas accept anything, so zod infers `unknown` as their input. The exported schemas
  restate the input as the parsed fields, all optional, which makes a misspelled value in a link a
  type error.

### Consequences

- Good, because a shared link reads like `/articles?q=疫苗&replyType=rumor,not-rumor` and opens
  the same view, and a mangled link still opens the page.
- Good, because number-like keywords and long numeric ids keep every character.
- Good, because a route gets parsing, defaults and typed links from one spread.
- Bad, because list items can never contain a comma. Today's lists hold enum values and ids,
  which do not.
- Bad, because the restated input type is a cast: it is only as correct as the schema's output
  type.
- Bad, because the param names are now a public contract. The design doc's rename proposal
  (`media`, `period`, `last-requested`…) is still open, and adopting it after launch would break
  shared links.
- Neutral, because old rumors-site list bookmarks open with default filters, as decided.

## Confirmation

`src/lib/__tests__/urlSearch.test.ts` and `src/lib/search-params/__tests__/` cover number-like
text, malformed percent-encoding, `__proto__`, every fallback, and parse, link, parse staying
stable. `pages.test.ts` has a `@ts-expect-error` on a misspelled link value, so `tsc` fails if
links stop being typed. A route that reads search params without these options should be caught
in review.

## Pros and Cons of the Options

### Router defaults (JSON values) with a schema per page

- Good, because there is nothing to maintain.
- Bad, because values are changed before the schema sees them (lost digits, dropped quotes), and
  links carry JSON quotes and arrays.

### Repeated keys for lists

- Good, because list items could contain commas.
- Bad, because links get longer (`replyType=` once per item). The parser still accepts this form,
  so hand-written links work either way.

### Keep rumors-site's names, or translate old params

- Good, because old bookmarks would keep their filters.
- Bad, because the old values are hard to read (`NO_USEFUL_REPLY_YET`, `now-1w/d`), the same name
  meant different things on different pages, and the design doc decided against compatibility.

## More Information

- kb: [Phase 3 網站遷移與前端架構](https://github.com/cofacts/kb/blob/main/src/technical-design/cofacts.ai/Phase%203%20網站遷移與前端架構.md),
  §2.1 to §2.3 and appendix A (rumors-site's params).
- The filters follow Penpot `Doubious Message-1440` and `Latest replies` (file Cofacts-2026).
- Revisit when the WG settles the rename proposal, before the list pages replace rumors-site on
  cofacts.tw.
