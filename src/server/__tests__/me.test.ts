import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { API_BASE } from '../api-base';
import { fetchMeWithToken } from '../me';

const VALID_USER = {
  id: 'user-1',
  name: 'Alice',
  avatarUrl: 'https://example.com/a.png',
};

function mockFetchOnce(response: Partial<Response> & { jsonValue?: unknown }) {
  const fn = vi.fn().mockResolvedValueOnce({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonValue,
  } as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchMeWithToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns user on 200 with valid GraphQL response', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      jsonValue: { data: { GetUser: VALID_USER } },
    });

    const result = await fetchMeWithToken('tok');
    expect(result).toEqual(VALID_USER);
  });

  test('returns null on 401', async () => {
    mockFetchOnce({ ok: false, status: 401, jsonValue: {} });
    const result = await fetchMeWithToken('tok');
    expect(result).toBeNull();
  });

  test('returns null on network error / fetch throw', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom'));
    vi.stubGlobal('fetch', fn);

    const result = await fetchMeWithToken('tok');
    expect(result).toBeNull();
  });

  test('returns null when GraphQL returns errors', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      jsonValue: { errors: [{ message: 'nope' }], data: null },
    });

    const result = await fetchMeWithToken('tok');
    expect(result).toBeNull();
  });

  test('returns null when GetUser is null', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      jsonValue: { data: { GetUser: null } },
    });

    const result = await fetchMeWithToken('tok');
    expect(result).toBeNull();
  });

  test('sends correct headers and POSTs the GetUser query to /graphql', async () => {
    const fn = mockFetchOnce({
      ok: true,
      status: 200,
      jsonValue: { data: { GetUser: VALID_USER } },
    });

    await fetchMeWithToken('my-token');

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/graphql`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer my-token',
      'x-app-id': 'RUMORS_SITE',
    });
    expect(init.body).toBe(
      JSON.stringify({ query: '{ GetUser { id name avatarUrl } }' }),
    );
  });
});
