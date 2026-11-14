import { afterEach, describe, expect, test } from 'vitest'

import { getArticleUrl, getSiteBase } from '../cofactsSite'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('getSiteBase', () => {
  test('maps each API host to the site it belongs with', () => {
    delete process.env.COFACTS_SITE_URL

    process.env.COFACTS_API_URL = 'https://dev-api.cofacts.tw'
    expect(getSiteBase()).toBe('https://dev.cofacts.tw')

    process.env.COFACTS_API_URL = 'https://api.cofacts.tw'
    expect(getSiteBase()).toBe('https://cofacts.tw')
  })

  test('tolerates a trailing slash on the API URL', () => {
    delete process.env.COFACTS_SITE_URL
    process.env.COFACTS_API_URL = 'https://dev-api.cofacts.tw/'
    expect(getSiteBase()).toBe('https://dev.cofacts.tw')
  })

  test('leaves a host that does not follow the convention alone', () => {
    delete process.env.COFACTS_SITE_URL
    process.env.COFACTS_API_URL = 'http://localhost:5000'
    expect(getSiteBase()).toBe('http://localhost:5000')
  })

  test('COFACTS_SITE_URL wins outright', () => {
    process.env.COFACTS_API_URL = 'https://dev-api.cofacts.tw'
    process.env.COFACTS_SITE_URL = 'https://staging.example.test/'
    expect(getSiteBase()).toBe('https://staging.example.test')
  })
})

describe('getArticleUrl', () => {
  test('points at the article on the matching site', () => {
    delete process.env.COFACTS_SITE_URL
    process.env.COFACTS_API_URL = 'https://dev-api.cofacts.tw'
    expect(getArticleUrl('abc123')).toBe(
      'https://dev.cofacts.tw/article/abc123',
    )
  })
})
