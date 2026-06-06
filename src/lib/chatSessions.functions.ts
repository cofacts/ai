import { createServerFn } from '@tanstack/react-start'
import { ADK_APP_NAME, adkClient } from './adkClient'
import { handleAdkError, handleAdkResponseError } from './adk-errors'
import { resolveAdkUserIdOrThrow } from '@/server/adkUser'

const SESSION_TITLE_KEY = 'title'

// lastEventTime: set by Python after_agent_callback when an agent turn completes.
// We avoid using ADK's built-in lastUpdateTime because any PATCH to session state
// (including writing lastOpenedAt) bumps it, causing sidebar sort to jump on session open.
const SESSION_LAST_EVENT_TIME_KEY = 'lastEventTime'

// lastOpenedAt: set by the client when the user opens a session, for cross-device unread tracking.
const SESSION_LAST_OPENED_KEY = 'lastOpenedAt'

export interface SessionListItem {
  id: string
  title: string
  lastUpdateTime: number
  lastEventTime?: number
  lastOpenedAt?: number
}

export const listSessions = createServerFn({ method: 'GET' }).handler(
  async () => {
    const userId = await resolveAdkUserIdOrThrow()
    const { data, error } = await adkClient.GET(
      '/apps/{app_name}/users/{user_id}/sessions',
      {
        params: {
          path: { app_name: ADK_APP_NAME, user_id: userId },
        },
      },
    )
    if (error) handleAdkError(error)
    return (data ?? []).map((session): SessionListItem => {
      const stateTitle = session.state?.[SESSION_TITLE_KEY]
      const lastEventTime = session.state?.[SESSION_LAST_EVENT_TIME_KEY]
      const lastOpenedAt = session.state?.[SESSION_LAST_OPENED_KEY]

      // list_sessions always returns events=[] in both SQLite and PostgreSQL backends.
      // We cannot provide meaningful fallback for data in the state.
      return {
        id: session.id,
        title:
          typeof stateTitle === 'string' && stateTitle
            ? stateTitle
            : session.id,
        lastUpdateTime: session.lastUpdateTime,
        lastEventTime:
          typeof lastEventTime === 'number' ? lastEventTime : undefined,
        lastOpenedAt:
          typeof lastOpenedAt === 'number' ? lastOpenedAt : undefined,
      }
    })
    .sort((a, b) => (b.lastEventTime ?? 0) - (a.lastEventTime ?? 0))
  },
)

export const getSession = createServerFn({ method: 'GET' })
  .inputValidator((sessionId: string) => sessionId)
  .handler(async ({ data: sessionId }) => {
    const userId = await resolveAdkUserIdOrThrow()
    const { data, error } = await adkClient.GET(
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
    if (error) handleAdkError(error)
    return data
  })

interface CreateSessionInput {
  sessionId: string
  name?: string
}

export const createSession = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateSessionInput) => input)
  .handler(async ({ data: { sessionId, name } }) => {
    const userId = await resolveAdkUserIdOrThrow()
    const { response } = await adkClient.POST(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: userId,
            session_id: sessionId,
          },
        },
        // In the updated ADK schema, the body for /sessions/{session_id} POST
        // is expected to be the initial state (Record<string, any>).
        body: {
          ...(name ? { [SESSION_TITLE_KEY]: name } : {}),
          [SESSION_LAST_EVENT_TIME_KEY]: Date.now() / 1000,
          [SESSION_LAST_OPENED_KEY]: Date.now() / 1000,
        },
      },
    )

    // 409 Conflict => already exists, which is fine for our use case.
    if (!response.ok && response.status !== 409) {
      handleAdkResponseError(response)
    }

    return { ok: true }
  })

interface UpdateSessionInput {
  sessionId: string
  title: string
}

export const updateSessionTitle = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateSessionInput) => input)
  .handler(async ({ data: { sessionId, title } }) => {
    const userId = await resolveAdkUserIdOrThrow()
    const { data, error } = await adkClient.PATCH(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: userId,
            session_id: sessionId,
          },
        },
        body: {
          stateDelta: { [SESSION_TITLE_KEY]: title },
        },
      },
    )
    if (error) handleAdkError(error)
    return data
  })

/**
 * Fetches the Google Search "suggestion pills" HTML for one investigator
 * tool-call, saved by the writer agent as an artifact keyed by the tool-call id.
 *
 * Returns the decoded HTML string, or `null` when no widget exists for this call
 * (e.g. the search returned no grounding, or the in-memory artifact was lost
 * after a server restart). Missing widgets are normal, so non-auth failures are
 * swallowed — this is a purely decorative feature and must never break the page.
 */
export const getSearchWidget = createServerFn({ method: 'GET' })
  .inputValidator((input: { sessionId: string; toolCallId: string }) => input)
  .handler(
    async ({ data: { sessionId, toolCallId } }): Promise<string | null> => {
      const userId = await resolveAdkUserIdOrThrow()
      const { data, error } = await adkClient.GET(
        '/apps/{app_name}/users/{user_id}/sessions/{session_id}/artifacts/{artifact_name}',
        {
          params: {
            path: {
              app_name: ADK_APP_NAME,
              user_id: userId,
              session_id: sessionId,
              artifact_name: `search-widget-${toolCallId}.html`,
            },
          },
        },
      )
      if (error) {
        console.error('[getSearchWidget]', error)
        return null
      }
      const base64 = data?.inlineData?.data
      if (!base64) return null
      return Buffer.from(base64, 'base64').toString('utf-8')
    },
  )

export const markSessionOpened = createServerFn({ method: 'POST' })
  .inputValidator((sessionId: string) => sessionId)
  .handler(async ({ data: sessionId }) => {
    const userId = await resolveAdkUserIdOrThrow()
    const { error } = await adkClient.PATCH(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: userId,
            session_id: sessionId,
          },
        },
        // Store as seconds (Date.now()/1000) to match Python's time.time() for comparison.
        body: {
          stateDelta: { [SESSION_LAST_OPENED_KEY]: Date.now() / 1000 },
        },
      },
    )
    if (error) handleAdkError(error)
    return { ok: true }
  })
