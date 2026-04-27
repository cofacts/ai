import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { deleteCookie } from '@tanstack/react-start/server';

import { Route } from '../logout';
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieAttrs,
} from '@/server/session';


vi.mock('@tanstack/react-start/server', () => ({
  deleteCookie: vi.fn(),
}));

type HandlerCtxLike = {
  request: Request;
  context: Record<string, unknown>;
  params: Record<string, unknown>;
  pathname: string;
  next: (...args: Array<unknown>) => unknown;
};

function getHandler() {
  const opts = (Route as unknown as { options: { server: { handlers: { POST: unknown } } } }).options;
  const entry = opts.server.handlers.POST;
  const fn =
    typeof entry === 'function'
      ? entry
      : (entry as { handler: unknown }).handler;
  return fn as (
    ctx: HandlerCtxLike,
  ) => Promise<Response> | Response;
}

describe('POST /api/auth/logout', () => {
  const deleteCookieMock = vi.mocked(deleteCookie);

  beforeEach(() => {
    deleteCookieMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('clears session cookie and returns 204', async () => {
    const handler = getHandler();
    const res = await handler({
      request: new Request('https://app.example.com/api/auth/logout', {
        method: 'POST',
      }),
      context: {},
      params: {},
      pathname: '/api/auth/logout',
      next: () => ({ isNext: true, context: {} }),
    });

    expect(deleteCookieMock).toHaveBeenCalledTimes(1);
    expect(deleteCookieMock).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      buildClearSessionCookieAttrs(),
    );
    expect(res.status).toBe(204);
  });
});
