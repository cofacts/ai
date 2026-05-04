import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getCookie, setCookie } from '@tanstack/react-start/server';

import { Route } from '../callback';
import { API_BASE } from '@/server/api-base';
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  buildClearOAuthStateCookieAttrs,
  buildSessionCookieAttrs,
} from '@/server/session';


vi.mock('@tanstack/react-start/server', () => ({
  setCookie: vi.fn(),
  getCookie: vi.fn(),
}));

type HandlerCtxLike = {
  request: Request;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
  pathname: string;
  next: (...args: Array<unknown>) => unknown;
};

function getHandler() {
  const opts = (Route as unknown as { options: { server: { handlers: { GET: unknown } } } }).options;
  const entry = opts.server.handlers.GET;
  const fn =
    typeof entry === 'function'
      ? entry
      : (entry as { handler: unknown }).handler;
  return fn as (
    ctx: HandlerCtxLike,
  ) => Promise<Response> | Response;
}

function invoke(url: string): Promise<Response> | Response {
  const handler = getHandler();
  return handler({
    request: new Request(url),
    context: {},
    params: {},
    pathname: '/api/auth/callback',
    next: () => ({ isNext: true, context: {} }),
  });
}

function encodeState(nonce: string, redirectPath: string): string {
  return Buffer.from(JSON.stringify({ n: nonce, r: redirectPath })).toString(
    'base64url',
  );
}

const NONCE = 'fixed-test-nonce-aaaaaaaaaaaaaaaa';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const FUTURE_JWT = makeJwt({ exp: FUTURE_EXP });

describe('GET /api/auth/callback', () => {
  const setCookieMock = vi.mocked(setCookie);
  const getCookieMock = vi.mocked(getCookie);

  beforeEach(() => {
    setCookieMock.mockClear();
    getCookieMock.mockReset();
    getCookieMock.mockImplementation((name: string) =>
      name === OAUTH_STATE_COOKIE_NAME ? NONCE : undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('happy path: matching nonce → exchanges code, sets session, clears state cookie, 302-redirects', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: FUTURE_JWT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const state = encodeState(NONCE, '/articles/123');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${API_BASE}/auth/token`);
    expect(calledInit?.method).toBe('POST');
    expect(JSON.parse(calledInit?.body as string)).toEqual({ code: 'abc' });

    expect(setCookieMock).toHaveBeenCalledTimes(2);
    expect(setCookieMock).toHaveBeenNthCalledWith(
      1,
      SESSION_COOKIE_NAME,
      FUTURE_JWT,
      buildSessionCookieAttrs(new Date(FUTURE_EXP * 1000)),
    );
    expect(setCookieMock).toHaveBeenNthCalledWith(
      2,
      OAUTH_STATE_COOKIE_NAME,
      '',
      buildClearOAuthStateCookieAttrs(),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      'https://app.example.com/articles/123',
    );
  });

  test('missing oauth_state cookie → 401, no token exchange, no session set', async () => {
    getCookieMock.mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const state = encodeState(NONCE, '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('cookie nonce ≠ state nonce → 401, no token exchange (CSRF / session-fixation guard)', async () => {
    getCookieMock.mockImplementation(() => 'attacker-issued-nonce-xxxxxxxxxx');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const state = encodeState(NONCE, '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('legacy state shape (plain base64url path, no JSON nonce) → 400', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const state = Buffer.from('/dashboard', 'utf-8').toString('base64url');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('state with empty nonce → 400', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const state = encodeState('', '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('missing code → 400, no fetch, no cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const state = encodeState(NONCE, '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?state=${state}`,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('missing state → 400, no fetch, no cookie', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc`,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('token endpoint returns 401 → 401, no cookie set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 401 }),
    );
    const state = encodeState(NONCE, '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=bad&state=${state}`,
    );
    expect(res.status).toBe(401);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('fetch throws → 500, no cookie set', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const state = encodeState(NONCE, '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(500);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('non-same-origin redirect path (state.r="http://evil") falls back to "/"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: FUTURE_JWT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const state = encodeState(NONCE, 'http://evil.com/steal');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://app.example.com/');
  });

  test('protocol-relative redirect path (state.r="//evil") falls back to "/"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: FUTURE_JWT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const state = encodeState(NONCE, '//evil.com/steal');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://app.example.com/');
  });

  test('invalid token response (no token field) → 500, no cookie set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const state = encodeState(NONCE, '/');
    const res = await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );
    expect(res.status).toBe(500);
    expect(setCookieMock).not.toHaveBeenCalled();
  });

  test('JWT without exp claim → session cookie has no expires (browser drops on close)', async () => {
    const jwt = makeJwt({ sub: 'user-1' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ token: jwt }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const state = encodeState(NONCE, '/');
    await invoke(
      `https://app.example.com/api/auth/callback?code=abc&state=${state}`,
    );

    expect(setCookieMock).toHaveBeenNthCalledWith(
      1,
      SESSION_COOKIE_NAME,
      jwt,
      buildSessionCookieAttrs(),
    );
  });
});
