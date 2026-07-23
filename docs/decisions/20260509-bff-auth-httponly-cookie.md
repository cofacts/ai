---
status: "accepted"
date: 2026-05-09
decision-makers: [nonumpa, MrOrz]
consulted:
informed:
---

# BFF authentication via a custom authorization-code flow and an HttpOnly cookie

## Context and Problem Statement

Cofacts.ai is a first-party TanStack Start app whose SSR server acts as a
Backend-for-Frontend (BFF). It must authenticate users against the existing Cofacts
`rumors-api` and then call that API — and the ADK agent — on their behalf. The legacy
`rumors-api` login relies on a `koa-session` cookie; we needed an auth model where the
session token is usable server-side for GraphQL and ADK calls, is never reachable from
browser JavaScript, and supports SSR (auth state on first paint) — without standing up OAuth
client registration or refresh-token infrastructure.

Scope: frontend (React auth state), BFF (login/callback/logout/GraphQL-proxy routes, SSR
loader), and a paired change in `rumors-api` (short-lived code + `/auth/token` exchange +
`Authorization: Bearer` context).

## Decision Drivers

- The long-lived session token must be invisible to client-side JavaScript (mitigate XSS).
- The login round-trip must be protected against CSRF.
- First-party app — avoid the complexity of a general OAuth client registry.
- Reuse the existing `rumors-api` social-login (Passport.js) flow and `COOKIE_MAXAGE`.
- The same token must be relayable to the ADK backend, whose tools also call `rumors-api`.

## Considered Options

- **Custom authorization-code flow via the BFF** — `rumors-api` issues a 30-second
  short-lived JWT as an authorization code; the BFF exchanges it server-to-server for a
  long-lived JWT stored in an HttpOnly cookie.
- Store the `rumors-api` JWT directly in browser-accessible storage (localStorage or a
  non-HttpOnly cookie).
- Full OAuth 2.0 with client registration and refresh tokens.
- Keep the legacy `koa-session` cookie as the only mechanism.

## Decision Outcome

Chosen option: **custom authorization-code flow via the BFF**, because it keeps the
long-lived token in an `HttpOnly` + `Secure` + `SameSite` cookie (never exposed to JS),
reuses the existing Passport.js login, and avoids both an OAuth client registry and
refresh-token infrastructure while remaining backward-compatible with the legacy frontend.

Key decisions:

1. **Short-lived JWT as the authorization code** — no stateful code store (DB/Redis).
2. **No OAuth app registry** — `redirect_to` is validated against an `ALLOWED_CALLBACK_URLS`
   allowlist; the BFF additionally enforces a same-origin allowlist and a CSRF `state` nonce.
3. **BFF proxy** — the browser talks only to the BFF; the BFF attaches the cookie, extracts
   the JWT, and calls `rumors-api` with `Authorization: Bearer <token>`.
4. **No refresh tokens** — the long-lived JWT mirrors `COOKIE_MAXAGE` (default 14 days); on
   expiry a 401 clears the cookie and the user is logged out natively.

As shipped (PR #25 + rumors-api #386): routes `GET /api/auth/login`, `GET /api/auth/callback`
(validates the CSRF `state`, exchanges the code at `POST /auth/token`), `POST /api/auth/logout`,
and a server-side `POST /api/graphql` proxy; `getCurrentUserServerFn` plus a root loader
hydrate `AuthProvider` so pages render authenticated on first paint. rumors-api adopted RS256
JWT + JWKS + `token_use` partitioning. Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=14d`.

### Consequences

- Good, because the session JWT is unreachable from browser JS (XSS-resistant) and the login
  round-trip is CSRF-protected via the `state` nonce.
- Good, because the BFF can locally verify the JWT to extract the ADK `user_id`, avoiding a
  rate-limited `rumors-api` round-trip on every request.
- Good, because it is fully backward-compatible: `rumors-api` still sets its legacy
  `koa-session` cookie, and the legacy frontend simply ignores the extra `?code=` parameter.
- Bad, because auth now spans two services (BFF + rumors-api) plus a bespoke code-exchange
  step that must be kept in sync.
- Bad, because there is no refresh — a 14-day expiry forces a full re-login.

## Confirmation

BFF auth-route tests under `src/**/__tests__/`; manual verification of the
login → callback → authenticated-GraphQL → logout flow; the session cookie is asserted
`HttpOnly` / `Secure` / `SameSite`.

## More Information

- Original design doc (migrated here from Cofacts KB):
  `src/technical-design/cofacts.ai/Authentication.md`; the options analysis lived in
  `src/research/cofacts.ai/Authentication Comparison.md`. The KB copy now points here.
- Implemented in [cofacts/ai#25](https://github.com/cofacts/ai/pull/25); paired rumors-api
  change [cofacts/rumors-api#386](https://github.com/cofacts/rumors-api/pull/386).
- How the token is then propagated from the BFF into the ADK backend is covered by
  [`20260603-auth-token-contextvar`](20260603-auth-token-contextvar.md).
- Full login / API-request / logout sequence diagrams are in the original design doc.
