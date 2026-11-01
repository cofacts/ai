---
status: 'accepted'
date: 2026-11-01
decision-makers: [MrOrz]
consulted:
informed:
---

# Server-side rendering with a session token that rumors-api rejects

## Context and Problem Statement

The BFF forwards the `cofacts_session` JWT to rumors-api as `Authorization: Bearer` on every
server-side query (`cofactsExec`, see
[`20260509-bff-auth-httponly-cookie`](20260509-bff-auth-httponly-cookie.md)), so SSR renders the
logged-in page. rumors-api rejects the **whole request** with HTTP 500 and
`Context creation failed: Invalid or expired Bearer token` when the token is invalid, before any
resolver runs, even for public queries such as `ListArticles`.

The cookie's `expires` is pinned to the JWT's `exp`, so a rejected token normally means the cookie
is already gone. It still happens when the device clock runs behind, rumors-api rotates its signing
key, or a token is revoked. Then a public page like `/articles` fails entirely, and the failure is
repeated on every navigation until the cookie expires.

Scope: BFF only (`src/server/cofacts.server.ts`, `src/server/me.functions.ts`); no change to the
cookie format, the ADK token propagation, or what the browser sees apart from the cleared cookie.
Driven by review of [#169](https://github.com/cofacts/ai/pull/169).

## Decision Drivers

- Public pages must render when the cookie holds a dead token; "logged out" is an acceptable
  outcome, an error page is not.
- No per-page split into an anonymous SSR query plus a separate logged-in query.
- The UI state must match the cookie: no "logged-out screen, cookie still set".
- Do not mask rumors-api outages as a logout.

## Considered Options

- Anonymous SSR everywhere, load the user on the client (what rumors-site does)
- Keep sending the token and fail the request (the previous behaviour)
- Retry anonymously on rejection, leaving the cookie alone
- Retry anonymously on rejection and clear the session cookie (chosen)
- Make the anonymous retry an opt-in option for public queries

## Decision Outcome

Chosen option: "retry anonymously on rejection and clear the session cookie", because it keeps
SSR as the logged-in view with one code path per page, makes a dead session look like a logout
instead of an error, and stops the repeated rejected requests.

`cofactsExec` treats **only** the `Invalid or expired Bearer token` error as a dead session. It
then deletes `cofacts_session` (same attributes as logout) and re-sends the request once without
`Authorization`. rumors-api fails in context creation before running resolvers, so retrying a
mutation cannot execute it twice. Every other failure (network error, 5xx, rate limit, GraphQL
errors) is thrown unchanged.

### Scenarios

| Scenario                                                                | Before                                                          | Now                                                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| No cookie                                                               | Anonymous request                                               | Unchanged                                                                                                        |
| Valid token                                                             | Authenticated request                                           | Unchanged                                                                                                        |
| Token rejected, public page (`/articles`)                               | Whole page fails (500)                                          | Cookie cleared, anonymous retry succeeds, page renders logged out                                                |
| Token rejected, next navigation                                         | Rejected again on every request                                 | No cookie, so plain anonymous requests                                                                           |
| Token rejected, root `GetUser`                                          | Throws, then the local JWT fallback returns a minimal user      | Cookie cleared, retry returns `GetUser: null`, user is logged out                                                |
| Token rejected, page that needs a login (`_ai` shell)                   | Appeared logged in through the fallback, then operations failed | Logged out, so the existing `!user` gate sends the user to log in                                                |
| Token rejected, mutation                                                | Throws                                                          | Retried without a token; rumors-api answers "login required", which is thrown                                    |
| rumors-api down, timing out or rate-limited (valid token)               | `GetUser` throws, local JWT fallback keeps the user logged in   | Unchanged: no cookie cleared, no retry, fallback still applies                                                   |
| Retry itself fails                                                      | n/a                                                             | The retry's error is thrown; the cookie is already cleared                                                       |
| Several loaders reject in the same request                              | n/a                                                             | Each retries once and deletes the cookie again; harmless                                                         |
| ADK chat calls (`resolveAdkUserIdOrThrow`)                              | Verifies the JWT locally, throws `AUTH_EXPIRED` on failure      | Unchanged                                                                                                        |
| JWT valid locally but rejected by rumors-api (key rotation, revocation) | Local fallback kept a fake logged-in user                       | Logged out; ADK calls still pass local verification until the JWT's own `exp`, a separate gap not addressed here |

### Consequences

- Good, because public pages survive a stale cookie with a single code path per page.
- Good, because the cookie and the UI agree, and the rejected token is sent at most once.
- Good, because the local JWT fallback in `me.functions.ts` stays, now scoped to rumors-api
  outages, where staying logged in is the right call.
- Bad, because an explicit rejection no longer emits `AUTH_EXPIRED`, so there is no "please log in
  again" prompt; the user just appears logged out.
- Bad, because the decision relies on matching rumors-api's error message text. If the message
  changes, the retry silently stops and pages fail again.
- Bad, because the retry is invisible to callers: `GetUser: null` can mean "never logged in" or
  "session just died".

## Confirmation

Unit tests in `src/server/__tests__/cofacts.server.test.ts` cover the retry, the cookie being
cleared, and other 500s not being retried. After a build, `Cookie: cofacts_session=abc.def.ghi`
against `/articles` should return 200 with a `Set-Cookie` that clears the session.

## Pros and Cons of the Options

### Anonymous SSR everywhere, load the user on the client

- Good, because it needs no retry logic and matches rumors-site.
- Bad, because every page needs an anonymous SSR query plus a separate logged-in query.
- Bad, because the server-rendered page is never the logged-in view.

### Keep sending the token and fail the request

- Good, because it is the simplest and never hides an auth problem.
- Bad, because a public page fails entirely, and keeps failing until the cookie expires.

### Retry anonymously, leave the cookie alone

- Good, because public pages render.
- Bad, because every request sends one rejected and one anonymous call.
- Bad, because the screen shows logged out while the cookie says logged in.

### Make the anonymous retry opt-in for public queries

- Good, because the default stays strict.
- Bad, because each public page must remember the option, and the root `GetUser` call would
  need it too.

## More Information

- Review threads on [#169](https://github.com/cofacts/ai/pull/169) (`cofacts.server.ts`).
- [`20260509-bff-auth-httponly-cookie`](20260509-bff-auth-httponly-cookie.md): the cookie and JWT
  flow this builds on.
- Not verified at the time of writing: that `deleteCookie` inside an SSR loader reaches the browser
  as `Set-Cookie` on the document response. Check this when touching the area.
