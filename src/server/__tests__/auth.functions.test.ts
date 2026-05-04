import { describe, expect, test } from 'vitest';

import { API_BASE } from '../api-base';
import {
  buildLoginUpstreamUrl,
  encodeState,
  isAllowedProvider,
  resolveOriginFromHeaders,
  sanitizeRedirectPath,
} from '../auth.functions';

const ORIGIN = 'https://example.com';

function decodeState(state: string): { n: string; r: string } {
  return JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'));
}

describe('isAllowedProvider', () => {
  test.each(['github', 'facebook', 'google'])('accepts %s', (p) => {
    expect(isAllowedProvider(p)).toBe(true);
  });

  test.each(['twitter', 'evil', '', '../admin', 'GitHub'])(
    'rejects %s',
    (p) => {
      expect(isAllowedProvider(p)).toBe(false);
    },
  );
});

describe('sanitizeRedirectPath', () => {
  test('keeps same-origin absolute path', () => {
    expect(sanitizeRedirectPath('/dashboard?x=1#y', ORIGIN)).toBe(
      '/dashboard?x=1#y',
    );
  });

  test('rejects protocol-relative URL', () => {
    expect(sanitizeRedirectPath('//evil.com/x', ORIGIN)).toBe('/');
  });

  test('rejects cross-origin URL', () => {
    expect(sanitizeRedirectPath('https://evil.com/x', ORIGIN)).toBe('/');
  });

  test('keeps same-origin absolute URL as path', () => {
    expect(sanitizeRedirectPath(`${ORIGIN}/foo?bar=1`, ORIGIN)).toBe(
      '/foo?bar=1',
    );
  });

  test('treats bare relative input as same-origin path', () => {
    expect(sanitizeRedirectPath('not a url', ORIGIN)).toBe('/not%20a%20url');
  });

  test('rejects javascript: scheme', () => {
    expect(sanitizeRedirectPath('javascript:alert(1)', ORIGIN)).toBe('/');
  });
});

describe('resolveOriginFromHeaders', () => {
  test('prefers Origin header', () => {
    const req = new Request('https://server.local/_serverFn/abc', {
      headers: { origin: ORIGIN, referer: 'https://other.com/x' },
    });
    expect(resolveOriginFromHeaders(req)).toBe(ORIGIN);
  });

  test('falls back to Referer when Origin missing', () => {
    const req = new Request('https://server.local/_serverFn/abc', {
      headers: { referer: `${ORIGIN}/page` },
    });
    expect(resolveOriginFromHeaders(req)).toBe(ORIGIN);
  });

  test('falls back to request.url origin when neither header set', () => {
    const req = new Request('https://server.local/_serverFn/abc');
    expect(resolveOriginFromHeaders(req)).toBe('https://server.local');
  });
});

describe('buildLoginUpstreamUrl', () => {
  const NONCE = 'fixed-nonce-for-test';

  test('builds upstream URL with same-origin callback and state', () => {
    const upstreamUrl = buildLoginUpstreamUrl(
      'github',
      '/dashboard',
      ORIGIN,
      NONCE,
    );
    const upstream = new URL(upstreamUrl);
    expect(`${upstream.origin}${upstream.pathname}`).toBe(
      `${API_BASE}/login/github`,
    );
    expect(upstream.searchParams.get('redirect_to')).toBe(
      `${ORIGIN}/api/auth/callback`,
    );
    const decoded = decodeState(upstream.searchParams.get('state')!);
    expect(decoded.r).toBe('/dashboard');
    expect(decoded.n).toBe(NONCE);
  });

  test('sanitizes cross-origin redirectTo before encoding into state', () => {
    const upstreamUrl = buildLoginUpstreamUrl(
      'google',
      'https://evil.com/x',
      ORIGIN,
      NONCE,
    );
    const decoded = decodeState(
      new URL(upstreamUrl).searchParams.get('state')!,
    );
    expect(decoded.r).toBe('/');
  });

  test('encodeState round-trips', () => {
    const s = encodeState('nonce-abc', '/path');
    expect(decodeState(s)).toEqual({ n: 'nonce-abc', r: '/path' });
  });
});
