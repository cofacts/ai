import { describe, expect, test } from 'vitest';

import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieAttrs,
  buildSessionCookieAttrs,
} from '../session';

describe('session cookie helpers', () => {
  test('exposes the expected cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('cofacts_session');
  });

  test('buildSessionCookieAttrs() with no expiry yields a session cookie (HttpOnly+Secure+Lax+/, no Max-Age, no Expires)', () => {
    expect(buildSessionCookieAttrs()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: undefined,
    });
  });

  test('buildSessionCookieAttrs(expires) pins absolute expiry to the JWT exp instant', () => {
    const expires = new Date('2030-01-02T03:04:05.000Z');
    expect(buildSessionCookieAttrs(expires)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires,
    });
  });

  test('buildClearSessionCookieAttrs sets maxAge=0 to delete the cookie', () => {
    expect(buildClearSessionCookieAttrs()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: undefined,
      maxAge: 0,
    });
  });
});
