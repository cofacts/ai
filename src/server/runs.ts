/**
 * The process's RunBus, wired to ADK over HTTP. ADK is used unchanged:
 * /run_sse to run, the session API to read and write the session.
 */
import { getRunBus } from './runBus'
import type { AdkAccess, RunBus, StoredEvent } from './runBus'
import { ADK_APP_NAME, adkClient } from '@/lib/adkClient'
import { AUTH_EXPIRED_MESSAGE } from '@/lib/authExpired'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'

const ADK_BASE_URL = process.env.ADK_URL || 'http://localhost:8000'

const adkAccess = (): AdkAccess => ({
  runSse: ({ userId, sessionId, newMessage, token, signal }) =>
    fetch(`${ADK_BASE_URL}/run_sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        appName: ADK_APP_NAME,
        userId,
        sessionId,
        newMessage,
        streaming: true,
      }),
      signal,
    }),

  sessionEvents: async (userId, sessionId) => {
    const { data, response } = await adkClient.GET(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: userId,
            session_id: sessionId,
          },
        },
      },
    )
    if (response.status === 404) return null
    if (!data) throw new Error(`ADK session read failed: ${response.status}`)
    return (data.events ?? []) as Array<StoredEvent>
  },

  patchState: async (userId, sessionId, stateDelta) => {
    const { response } = await adkClient.PATCH(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: userId,
            session_id: sessionId,
          },
        },
        body: { stateDelta: stateDelta as Record<string, {}> },
      },
    )
    if (!response.ok)
      throw new Error(`ADK state write failed: ${response.status}`)
  },
})

/** The RunBus, or null when REDIS_URL is unset (background runs off). */
export function runBus(): RunBus | null {
  return getRunBus(adkAccess)
}

/**
 * What every /api/runs/:sessionId/* route needs first: the signed-in user
 * and the bus. Answers 401 when the login expired and 503
 * {"detail": {"reason": "disabled"}} when background runs are off, which
 * makes the client fall back to /api/run-sse.
 */
export async function runRoute(): Promise<
  { userId: string; bus: RunBus } | { response: Response }
> {
  let userId: string
  try {
    userId = await resolveAdkUserIdOrThrow()
  } catch (err) {
    if (err instanceof Error && err.message === AUTH_EXPIRED_MESSAGE) {
      return { response: json({ message: 'Authentication required' }, 401) }
    }
    throw err
  }
  const bus = runBus()
  if (!bus) return { response: json({ detail: { reason: 'disabled' } }, 503) }
  return { userId, bus }
}

export function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
