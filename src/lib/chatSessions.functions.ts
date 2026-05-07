import { createServerFn } from '@tanstack/react-start'
import { ADK_APP_NAME, ADK_USER_ID, adkClient } from './adkClient'
import { handleAdkError, handleAdkResponseError } from './adk-errors'

const SESSION_TITLE_KEY = 'title'
const SESSION_LAST_OPENED_KEY = 'lastOpenedAt'

export interface SessionListItem {
  id: string
  name: string
  lastUpdateTime: number
  lastOpenedAt?: number
}

export const listSessions = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { data, error } = await adkClient.GET(
      '/apps/{app_name}/users/{user_id}/sessions',
      {
        params: {
          path: { app_name: ADK_APP_NAME, user_id: ADK_USER_ID },
        },
      },
    )
    if (error) handleAdkError(error)
    return (data ?? []).map((session): SessionListItem => {
      const stateTitle = session.state?.[SESSION_TITLE_KEY]
      const name =
        typeof stateTitle === 'string' && stateTitle
          ? stateTitle
          : (session.events
              ?.find(
                (e) => e.content?.role === 'user' && e.content.parts?.[0]?.text,
              )
              ?.content?.parts?.[0]?.text?.slice(0, 40) ?? session.id)
      const lastOpenedAt = session.state?.[SESSION_LAST_OPENED_KEY]
      return {
        id: session.id,
        name,
        lastUpdateTime: session.lastUpdateTime,
        lastOpenedAt: typeof lastOpenedAt === 'number' ? lastOpenedAt : undefined,
      }
    })
  },
)

export const getSession = createServerFn({ method: 'GET' })
  .inputValidator((sessionId: string) => sessionId)
  .handler(async ({ data: sessionId }) => {
    const { data, error } = await adkClient.GET(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: ADK_USER_ID,
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
    const { response } = await adkClient.POST(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: ADK_USER_ID,
            session_id: sessionId,
          },
        },
        // In the updated ADK schema, the body for /sessions/{session_id} POST
        // is expected to be the initial state (Record<string, any>).
        body: name ? { [SESSION_TITLE_KEY]: name } : {},
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
  name: string
}

export const updateSession = createServerFn({ method: 'POST' })
  .inputValidator((input: UpdateSessionInput) => input)
  .handler(async ({ data: { sessionId, name } }) => {
    const { data, error } = await adkClient.PATCH(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: ADK_USER_ID,
            session_id: sessionId,
          },
        },
        body: {
          stateDelta: { [SESSION_TITLE_KEY]: name },
        },
      },
    )
    if (error) handleAdkError(error)
    return data
  })

export const markSessionOpened = createServerFn({ method: 'POST' })
  .inputValidator((sessionId: string) => sessionId)
  .handler(async ({ data: sessionId }) => {
    const { error } = await adkClient.PATCH(
      '/apps/{app_name}/users/{user_id}/sessions/{session_id}',
      {
        params: {
          path: {
            app_name: ADK_APP_NAME,
            user_id: ADK_USER_ID,
            session_id: sessionId,
          },
        },
        body: {
          stateDelta: { [SESSION_LAST_OPENED_KEY]: Date.now() },
        },
      },
    )
    if (error) handleAdkError(error)
    return { ok: true }
  })
