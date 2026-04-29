// BFF GraphQL proxy.
//
// Forwards POST requests from the browser to rumors-api's /graphql endpoint,
// attaching the cofacts_session cookie's JWT as a Bearer token. The raw
// request body is forwarded byte-for-byte to preserve operationName, variables
// and any other fields exactly as sent by the client.
//
// The cookie is HttpOnly+Secure+SameSite=Lax, so we forward without verifying
// locally — rumors-api is the single source of truth for token validity.
//
// Public queries continue to work without a cookie: when no session cookie is
// present, the Authorization header is omitted entirely.
//
// 401 recovery: rumors-api hard-fails the request when a Bearer token is
// invalid/expired (it does NOT silently fall back to anonymous, to prevent
// confused-deputy attacks). Without recovery, an expired session would break
// even public queries until the user manually clears cookies. To smooth the
// edge case where the cookie outlives the JWT, we retry once without the
// Authorization header AND clear the session cookie. Public queries succeed on
// the retry; authed queries surface a clean 401 to the caller. The cleared
// cookie ensures subsequent requests go straight to anonymous, so the 401
// loop only happens once.
//
// Upstream response status is preserved verbatim. We do NOT forward upstream
// headers (e.g. Set-Cookie) to avoid leaking server-side state to the browser.

import { createFileRoute } from '@tanstack/react-router';
import { deleteCookie, getCookie } from '@tanstack/react-start/server';

import { API_BASE } from '@/server/api-base';
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieAttrs,
} from '@/server/session';

export const Route = createFileRoute('/api/graphql')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = getCookie(SESSION_COOKIE_NAME);
        const body = await request.text();

        const baseHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-app-id': 'RUMORS_SITE',
        };

        async function callUpstream(authToken: string | undefined) {
          const headers: Record<string, string> = { ...baseHeaders };
          if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
          return fetch(`${API_BASE}/graphql`, {
            method: 'POST',
            headers,
            body,
          });
        }

        let upstream: Response;
        try {
          upstream = await callUpstream(token);
        } catch {
          return new Response(
            JSON.stringify({ errors: [{ message: 'Upstream unavailable' }] }),
            {
              status: 502,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        // Stale-cookie recovery: if rumors-api rejected our Bearer token, the
        // session is dead. Retry once anonymously so public queries still work
        // for the user, and clear the cookie so subsequent requests skip this
        // detour. If no token was sent, there's nothing to recover from.
        if (upstream.status === 401 && token) {
          deleteCookie(SESSION_COOKIE_NAME, buildClearSessionCookieAttrs());
          try {
            upstream = await callUpstream(undefined);
          } catch {
            return new Response(
              JSON.stringify({
                errors: [{ message: 'Upstream unavailable' }],
              }),
              {
                status: 502,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
        }

        return new Response(upstream.body, {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  },
});
