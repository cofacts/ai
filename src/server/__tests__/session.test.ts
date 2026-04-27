import { describe, expect, test } from 'vitest';

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  buildClearSessionCookieAttrs,
  buildSessionCookieAttrs,
} from '../session';

describe('session cookie helpers', () => {
  test('exposes the expected cookie name and 14d max age', () => {
    expect(SESSION_COOKIE_NAME).toBe('cofacts_session');
    expect(SESSION_MAX_AGE_SECONDS).toBe(1209600);
  });

  test('buildSessionCookieAttrs returns HttpOnly+Secure+Lax+/+14d', () => {
    expect(buildSessionCookieAttrs()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 1209600,
    });
  });

  test('buildClearSessionCookieAttrs matches but with maxAge=0', () => {
    expect(buildClearSessionCookieAttrs()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  });
});
