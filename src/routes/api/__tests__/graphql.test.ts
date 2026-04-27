import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getCookie } from '@tanstack/react-start/server';

import { Route } from '../graphql';
import { API_BASE } from '@/server/api-base';


vi.mock('@tanstack/react-start/server', () => ({
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
  const opts = (
    Route as unknown as {
      options: { server: { handlers: { POST: unknown } } };
    }
  ).options;
  const entry = opts.server.handlers.POST;
  const fn =
    typeof entry === 'function'
      ? entry
      : (entry as { handler: unknown }).handler;
  return fn as (ctx: HandlerCtxLike) => Promise<Response> | Response;
}

function invoke(body: string): Promise<Response> | Response {
  const handler = getHandler();
  return handler({
    request: new Request('https://app.example.com/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    context: {},
    params: {},
    pathname: '/api/graphql',
    next: () => ({ isNext: true, context: {} }),
  });
}

describe('POST /api/graphql', () => {
  const getCookieMock = vi.mocked(getCookie);

  beforeEach(() => {
    getCookieMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('with cookie: forwards body and adds Authorization + x-app-id headers', async () => {
    getCookieMock.mockReturnValue('jwt-abc');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { __typename: 'Query' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const sentBody = JSON.stringify({ query: '{ __typename }' });
    const res = await invoke(sentBody);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${API_BASE}/graphql`);
    expect(calledInit?.method).toBe('POST');
    expect(calledInit?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-app-id': 'RUMORS_SITE',
      Authorization: 'Bearer jwt-abc',
    });
    expect(calledInit?.body).toBe(sentBody);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({ data: { __typename: 'Query' } });
  });

  test('without cookie: forwards but omits Authorization header', async () => {
    getCookieMock.mockReturnValue(undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { __typename: 'Query' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const sentBody = JSON.stringify({ query: '{ __typename }' });
    const res = await invoke(sentBody);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, calledInit] = fetchMock.mock.calls[0];
    const headers = calledInit?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['x-app-id']).toBe('RUMORS_SITE');
    expect(headers['Content-Type']).toBe('application/json');

    expect(res.status).toBe(200);
  });

  test('upstream returns 401: status preserved and body forwarded as-is', async () => {
    getCookieMock.mockReturnValue('jwt-bad');
    const upstreamBody = JSON.stringify({
      errors: [{ message: 'Unauthorized' }],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(upstreamBody, {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await invoke(JSON.stringify({ query: '{ me { id } }' }));

    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.text()).toBe(upstreamBody);
  });

  test('upstream fetch throws: returns 502 with error envelope', async () => {
    getCookieMock.mockReturnValue('jwt-abc');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('econnrefused'));

    const res = await invoke(JSON.stringify({ query: '{ __typename }' }));

    expect(res.status).toBe(502);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({
      errors: [{ message: 'Upstream unavailable' }],
    });
  });
});
