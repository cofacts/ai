// BFF OAuth callback handler.
//
// Flow: rumors-api redirects the browser back here with `?code=...&state=...`
// after the user authorizes. We:
//
//   1. Decode `state` (base64url JSON of `{ n: nonce, r: redirectPath }`).
//   2. Read the `cofacts_oauth_state` cookie set by /api/auth/login.
//   3. Constant-time-compare the cookie nonce with `state.n`.
//      Mismatch = CSRF / session-fixation attempt → 401, no token exchange.
//   4. Validate `state.r` is a single-slash same-origin path; fall back to '/'.
//   5. Exchange `code` with rumors-api's /auth/token endpoint, store the
//      resulting JWT in the HttpOnly `cofacts_session` cookie.
//   6. Clear the one-shot `cofacts_oauth_state` cookie and redirect to the
//      validated path.

import { timingSafeEqual } from 'node:crypto';

import { createFileRoute } from '@tanstack/react-router';
import { getCookie, setCookie } from '@tanstack/react-start/server';
import { decodeJwt } from 'jose';

import { getApiBase } from '@/server/api-base';
import type { Nonce } from '@/server/auth.functions';
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  buildClearOAuthStateCookieAttrs,
  buildSessionCookieAttrs,
} from '@/server/sessionCookie';

interface DecodedState {
  nonce: string;
  redirectPath: string;
}

function decodeState(state: string): DecodedState | null {
  try {
    const json = Buffer.from(state, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'n' in parsed &&
      'r' in parsed &&
      typeof (parsed as { n: unknown }).n === 'string' &&
      typeof (parsed as { r: unknown }).r === 'string'
    ) {
      const { n, r } = parsed as Nonce;
      if (n.length === 0) return null;
      return { nonce: n, redirectPath: r };
    }
  } catch {
    // fall through
  }
  return null;
}

function safeRedirectPath(path: string, origin: string): string {
  // Backslashes are folded into forward slashes by WHATWG URL parsing, so a
  // value like `/\\evil.com/x` resolves to `https://evil.com/x` even though
  // it starts with `/`. Resolve against the page origin and require the
  // result to stay same-origin.
  if (path.includes('\\')) return '/';
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  try {
    const resolved = new URL(path, origin);
    if (resolved.origin !== origin) return '/';
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return '/';
  }
}

function noncesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute('/api/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code || !state) {
          return new Response('Missing code or state', { status: 400 });
        }

        const decoded = decodeState(state);
        if (!decoded) {
          return new Response('Invalid state', { status: 400 });
        }

        const cookieNonce = getCookie(OAUTH_STATE_COOKIE_NAME);
        if (!cookieNonce || !noncesMatch(cookieNonce, decoded.nonce)) {
          return new Response('State mismatch', { status: 401 });
        }

        const redirectPath = safeRedirectPath(decoded.redirectPath, url.origin);

        let tokenRes: Response;
        try {
          tokenRes = await fetch(`${getApiBase()}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
        } catch {
          return new Response('Token exchange failed', { status: 500 });
        }

        if (!tokenRes.ok) {
          return new Response('Token exchange rejected', { status: 401 });
        }

        let data: { token?: unknown };
        try {
          data = (await tokenRes.json()) as { token?: unknown };
        } catch {
          return new Response('Invalid token response', { status: 500 });
        }
        if (typeof data.token !== 'string' || data.token.length === 0) {
          return new Response('Invalid token response', { status: 500 });
        }

        // Pin the session cookie's lifetime to the JWT's `exp` claim so
        // browser and server agree on when the session ends. Edge cases:
        //   - exp absent  → undefined → session cookie (browser drops on close)
        //   - exp in past → past Date → browser immediately drops the cookie
        //   - decodeJwt throws on malformed token → 500
        const { exp } = decodeJwt(data.token);
        const expires = exp ? new Date(exp * 1000) : undefined;
        setCookie(
          SESSION_COOKIE_NAME,
          data.token,
          buildSessionCookieAttrs(expires),
        );
        setCookie(
          OAUTH_STATE_COOKIE_NAME,
          '',
          buildClearOAuthStateCookieAttrs(),
        );

        const dest = new URL(redirectPath, url.origin);
        return new Response(null, {
          status: 302,
          headers: { Location: dest.toString() },
        });
      },
    },
  },
});
