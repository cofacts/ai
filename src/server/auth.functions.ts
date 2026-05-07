// BFF login initiator.
//
// `login` is a TanStack Start server function: the browser imports it and
// calls it like a normal function, but the compiler rewrites the call into
// an RPC and the handler body only ever runs server-side. The handler
// owns the security-sensitive pieces of the OAuth start flow:
//
//   1. Whitelisting the provider (path-injection defense).
//   2. Sanitizing the post-login redirect path to a same-origin path
//      (rejects `//evil.com`, cross-origin URLs, and `javascript:` schemes).
//   3. Generating a random nonce, embedding it into both the OAuth `state`
//      parameter AND an HttpOnly `cofacts_oauth_state` cookie. The
//      callback requires both halves to match — CSRF / fixation defense.
//   4. Throwing a `redirect` to the upstream rumors-api login URL. The
//      rumors-api origin is server-only under the BFF model.
//
// The matching `/api/auth/callback` stays a file route because rumors-api
// redirects the browser to it — its URL is an external contract.
//
// The pure helpers below are exported so they can be unit-tested without
// the server-fn runtime; the RPC request URL points at the internal
// `/_serverFn/...` endpoint, so the page origin must be recovered from
// the `Origin` / `Referer` headers (request.url is useless here).

import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { deleteCookie, getRequest, setCookie } from '@tanstack/react-start/server';

import { getApiBase } from './api-base';
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  buildClearSessionCookieAttrs,
  buildOAuthStateCookieAttrs,
} from './session';

export const ALLOWED_PROVIDERS = ['github', 'facebook', 'google'] as const;
export type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number];

export function isAllowedProvider(value: string): value is AllowedProvider {
  return (ALLOWED_PROVIDERS as ReadonlyArray<string>).includes(value);
}

export function sanitizeRedirectPath(
  redirectTo: string,
  origin: string,
): string {
  // WHATWG URL parsing folds backslashes into forward slashes, so e.g.
  // `/\\evil.com/x` resolves to `https://evil.com/x`. Reject the input
  // outright instead of trusting startsWith('/').
  if (redirectTo.includes('\\')) return '/';
  if (redirectTo.startsWith('//')) return '/';
  if (redirectTo.startsWith('/')) return redirectTo;
  try {
    const url = new URL(redirectTo, origin);
    if (url.origin === origin) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // Falls through to the safe default below.
  }
  return '/';
}

export interface Nonce {
  n: string;
  r: string;
}

export function encodeState(nonce: string, redirectPath: string): string {
  const payload: Nonce = { n: nonce, r: redirectPath };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function resolveOriginFromHeaders(request: Request): string {
  const originHeader = request.headers.get('origin');
  if (originHeader) return originHeader;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Falls through to request.url below.
    }
  }
  return new URL(request.url).origin;
}

export function buildLoginUpstreamUrl(
  provider: AllowedProvider,
  redirectTo: string,
  origin: string,
  nonce: string,
): string {
  const safePath = sanitizeRedirectPath(redirectTo, origin);
  const state = encodeState(nonce, safePath);
  const callbackUrl = `${origin}/api/auth/callback`;

  const upstream = new URL(`${getApiBase()}/login/${provider}`);
  upstream.searchParams.set('redirect_to', callbackUrl);
  upstream.searchParams.set('state', state);

  return upstream.toString();
}

export interface LoginInput {
  provider: string;
  redirectTo?: string;
}

export const login = createServerFn({ method: 'POST' })
  .inputValidator((input: LoginInput) => {
    if (!isAllowedProvider(input.provider)) {
      throw new Error('Invalid provider');
    }
    const provider: AllowedProvider = input.provider;
    return { provider, redirectTo: input.redirectTo ?? '/' };
  })
  .handler(async ({ data }) => {
    const { randomBytes } = await import('node:crypto');
    const request = getRequest();
    const origin = resolveOriginFromHeaders(request);
    const nonce = randomBytes(32).toString('base64url');
    const upstreamUrl = buildLoginUpstreamUrl(
      data.provider,
      data.redirectTo,
      origin,
      nonce,
    );

    setCookie(OAUTH_STATE_COOKIE_NAME, nonce, buildOAuthStateCookieAttrs());

    throw redirect({ href: upstreamUrl });
  });

// BFF logout. Clears the cofacts_session HttpOnly cookie by issuing
// Set-Cookie with Max-Age=0 and the same attributes used at set time, so
// browsers reliably remove it. Returns null so the client can resolve.
export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  deleteCookie(SESSION_COOKIE_NAME, buildClearSessionCookieAttrs());
  return null;
});
