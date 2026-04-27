import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { setCookie } from '@tanstack/react-start/server';

import { Route } from '../login';
import { API_BASE } from '@/server/api-base';
import {
  OAUTH_STATE_COOKIE_NAME,
  buildOAuthStateCookieAttrs,
} from '@/server/session';


vi.mock('@tanstack/react-start/server', () => ({
  setCookie: vi.fn(),
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
  return fn as (ctx: HandlerCtxLike) => Promise<Response> | Response;
}

async function invoke(url: string): Promise<Response> {
  const handler = getHandler();
  return await handler({
    request: new Request(url),
    context: {},
    params: {},
    pathname: '/api/auth/login',
    next: () => ({ isNext: true, context: {} }),
  });
}

function decodeState(state: string): { n: string; r: string } {
  return JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
}

const ORIGIN = 'https://example.com';

describe('GET /api/auth/login', () => {
  const setCookieMock = vi.mocked(setCookie);

  beforeEach(() => {
    setCookieMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('redirects to upstream Twitter login with same-origin callback and state', async () => {
    const res = await invoke(`${ORIGIN}/api/auth/login?redirect_to=/dashboard`);
    expect(res.status).toBe(302);

    const location = res.headers.get('Location')!;
    const upstream = new URL(location);

    expect(`${upstream.origin}${upstream.pathname}`).toBe(
      `${API_BASE}/login/twitter`,
    );
    expect(upstream.searchParams.get('redirect_to')).toBe(
      `${ORIGIN}/api/auth/callback`,
    );
    const decoded = decodeState(upstream.searchParams.get('state')!);
    expect(decoded.r).toBe('/dashboard');
    expect(decoded.n).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  test('sets HttpOnly oauth_state cookie with the same nonce as state.n', async () => {
    const res = await invoke(`${ORIGIN}/api/auth/login?redirect_to=/x`);

    expect(setCookieMock).toHaveBeenCalledTimes(1);
    const [name, value, attrs] = setCookieMock.mock.calls[0];
    expect(name).toBe(OAUTH_STATE_COOKIE_NAME);
    expect(attrs).toEqual(buildOAuthStateCookieAttrs());

    const upstream = new URL(res.headers.get('Location')!);
    const decoded = decodeState(upstream.searchParams.get('state')!);
    expect(value).toBe(decoded.n);
  });

  test('each call generates a distinct nonce', async () => {
    await invoke(`${ORIGIN}/api/auth/login`);
    const nonceA = setCookieMock.mock.calls[0][1];
    setCookieMock.mockClear();

    await invoke(`${ORIGIN}/api/auth/login`);
    const nonceB = setCookieMock.mock.calls[0][1];

    expect(nonceA).not.toBe(nonceB);
    expect(nonceA.length).toBeGreaterThanOrEqual(32);
  });

  test('defaults redirect_to to /', async () => {
    const res = await invoke(`${ORIGIN}/api/auth/login`);
    expect(res.status).toBe(302);

    const upstream = new URL(res.headers.get('Location')!);
    expect(decodeState(upstream.searchParams.get('state')!).r).toBe('/');
  });

  test('rejects protocol-relative redirect_to', async () => {
    const res = await invoke(
      `${ORIGIN}/api/auth/login?redirect_to=${encodeURIComponent('//evil.com/x')}`,
    );

    const upstream = new URL(res.headers.get('Location')!);
    expect(decodeState(upstream.searchParams.get('state')!).r).toBe('/');
  });

  test('rejects cross-origin absolute redirect_to', async () => {
    const res = await invoke(
      `${ORIGIN}/api/auth/login?redirect_to=${encodeURIComponent('https://evil.com/x')}`,
    );

    const upstream = new URL(res.headers.get('Location')!);
    expect(decodeState(upstream.searchParams.get('state')!).r).toBe('/');
  });

  test('extracts pathname+search+hash from same-origin absolute URL', async () => {
    const res = await invoke(
      `${ORIGIN}/api/auth/login?redirect_to=${encodeURIComponent(`${ORIGIN}/page?q=1#top`)}`,
    );

    const upstream = new URL(res.headers.get('Location')!);
    expect(decodeState(upstream.searchParams.get('state')!).r).toBe(
      '/page?q=1#top',
    );
  });

  test('preserves search and hash on relative path', async () => {
    const res = await invoke(
      `${ORIGIN}/api/auth/login?redirect_to=${encodeURIComponent('/article/123?x=1#top')}`,
    );

    const upstream = new URL(res.headers.get('Location')!);
    expect(decodeState(upstream.searchParams.get('state')!).r).toBe(
      '/article/123?x=1#top',
    );
  });

  test('callback URL origin matches request origin (preserves dev/staging/prod)', async () => {
    const res = await invoke('https://staging.cofacts.ai/api/auth/login');
    const upstream = new URL(res.headers.get('Location')!);
    expect(upstream.searchParams.get('redirect_to')).toBe(
      'https://staging.cofacts.ai/api/auth/callback',
    );
  });
});
