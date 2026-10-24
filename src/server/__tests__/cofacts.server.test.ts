import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getCookie } from '@tanstack/react-start/server'
import { cofactsExec } from '../cofacts.server'
import { getApiBase } from '@/server/api-base'
import { graphql } from '@/server/gql'

vi.mock('@tanstack/react-start/server', () => ({
  getCookie: vi.fn(),
}))

const mockedGetCookie = vi.mocked(getCookie)

const TestQuery = graphql(`
  query GetCurrentUser {
    GetUser {
      id
      name
      avatarUrl
      avatarType
      avatarData
    }
  }
`)

const VALID_USER = {
  id: 'user-1',
  name: 'Alice',
  avatarUrl: 'https://example.com/a.png',
  avatarType: 'OpenPeeps',
  avatarData: null,
}

function mockFetchOnce(response: {
  ok?: boolean
  status?: number
  jsonValue?: unknown
}) {
  const fn = vi.fn().mockResolvedValueOnce({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonValue,
  } as unknown as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('cofactsExec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetCookie.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns typed data on 200 with valid GraphQL response', async () => {
    mockFetchOnce({
      jsonValue: { data: { GetUser: VALID_USER } },
    })

    const result = await cofactsExec(TestQuery)
    expect(result.GetUser).toEqual(VALID_USER)
  })

  test('throws on non-2xx', async () => {
    mockFetchOnce({ ok: false, status: 500, jsonValue: {} })
    await expect(cofactsExec(TestQuery)).rejects.toThrow(/500/)
  })

  test('throws when GraphQL returns errors', async () => {
    mockFetchOnce({
      jsonValue: { errors: [{ message: 'nope' }], data: null },
    })
    await expect(cofactsExec(TestQuery)).rejects.toThrow('nope')
  })

  test('throws on network error / fetch reject', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom'))
    vi.stubGlobal('fetch', fn)
    await expect(cofactsExec(TestQuery)).rejects.toThrow('boom')
  })

  test('throws when data is null and no errors', async () => {
    mockFetchOnce({ jsonValue: { data: null } })
    await expect(cofactsExec(TestQuery)).rejects.toThrow(/no data/)
  })

  test('POSTs printed query to /graphql with x-app-id and Content-Type', async () => {
    const fn = mockFetchOnce({ jsonValue: { data: { GetUser: VALID_USER } } })

    await cofactsExec(TestQuery)

    expect(fn).toHaveBeenCalledTimes(1)
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${getApiBase()}/graphql`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-app-id': 'RUMORS_SITE',
    })
    expect(init.headers).not.toHaveProperty('Authorization')

    const body = JSON.parse(init.body as string)
    expect(body.query).toContain('query GetCurrentUser')
    expect(body.query).toContain('GetUser')
    expect(body.variables).toBeUndefined()
  })

  test('includes Authorization header when session cookie is present', async () => {
    mockedGetCookie.mockReturnValue('jwt-abc')
    const fn = mockFetchOnce({ jsonValue: { data: { GetUser: VALID_USER } } })

    await cofactsExec(TestQuery)

    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt-abc',
    })
  })

  test('retries without the token when rumors-api rejects it', async () => {
    mockedGetCookie.mockReturnValue('expired-jwt')
    const reply = (status: number, json: unknown) =>
      ({
        ok: status < 400,
        status,
        json: () => Promise.resolve(json),
      }) as unknown as Response
    const fn = vi
      .fn()
      .mockResolvedValueOnce(
        reply(500, {
          errors: [
            {
              message:
                'Context creation failed: Invalid or expired Bearer token',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(reply(200, { data: { GetUser: VALID_USER } }))
    vi.stubGlobal('fetch', fn)

    const result = await cofactsExec(TestQuery)

    expect(result.GetUser).toEqual(VALID_USER)
    expect(fn).toHaveBeenCalledTimes(2)
    const [, retry] = fn.mock.calls[1] as [string, RequestInit]
    expect(retry.headers).not.toHaveProperty('Authorization')
  })

  test('does not retry other server errors', async () => {
    mockedGetCookie.mockReturnValue('jwt-abc')
    const fn = mockFetchOnce({
      ok: false,
      status: 500,
      jsonValue: { errors: [{ message: 'database down' }] },
    })
    await expect(cofactsExec(TestQuery)).rejects.toThrow(/500/)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('forwards variables in the POST body', async () => {
    const fn = mockFetchOnce({ jsonValue: { data: { GetUser: VALID_USER } } })

    await cofactsExec(TestQuery, undefined)

    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toHaveProperty('query')
  })
})
