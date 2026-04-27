// Component tests for AuthProvider/useAuth are intentionally omitted: the
// project's Vitest setup (vite.config.ts) does not wire @vitejs/plugin-react
// into the test pipeline, so React 19's hooks dispatcher is null inside any
// render and useState throws. Adding vitest-specific React support is out of
// scope. The security-relevant URL building moved server-side to
// /api/auth/login (see routes/api/auth/__tests__/login.test.ts) where it
// belongs under the BFF model; only the trivial relative-path builder
// remains client-side and is covered here.
import { describe, expect, test } from 'vitest'
import { buildLoginPath } from '../auth'

describe('buildLoginPath', () => {
  test('points at the BFF login route, not upstream', () => {
    expect(buildLoginPath('/dashboard')).toMatch(/^\/api\/auth\/login\?/)
  })

  test('encodes redirect_to so query parsing is unambiguous', () => {
    expect(buildLoginPath('/article/123?x=1#top')).toBe(
      '/api/auth/login?redirect_to=' +
        encodeURIComponent('/article/123?x=1#top'),
    )
  })

  test('defaults to /', () => {
    expect(buildLoginPath()).toBe('/api/auth/login?redirect_to=%2F')
  })
})
