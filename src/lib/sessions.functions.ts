import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { adkClient, ADK_APP_NAME, ADK_USER_ID } from './adkClient'
import type { AdkEvent } from './adk'
import type { components } from './adk-types'

type RunRequest = components['schemas']['RunAgentRequest']

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
    if (error) throw new Error(JSON.stringify(error))
    return data
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
    if (error) throw new Error(JSON.stringify(error))
    return data
  })

export const createSession = createServerFn({ method: 'POST' })
  .inputValidator((sessionId: string) => sessionId)
  .handler(async ({ data: sessionId }) => {
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
        // OpenAPI spec expects body for this POST request
        body: {},
      },
    )

    // 409 Conflict => already exists, which is fine for our use case.
    if (!response.ok && response.status !== 409) {
      throw new Error(`ADK error: ${response.status} ${response.statusText}`)
    }

    return { ok: true }
  })

export const runChat = createServerFn({ method: 'POST' })
  .inputValidator((data: RunRequest) => data)
  .handler(async function* ({ data: body }) {
    const { response } = await adkClient.POST('/run_sse', {
      parseAs: 'stream',
      body,
      signal: getRequest().signal,
    })

    if (!response.ok) {
      throw new Error(`ADK returned ${response.status}: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body from ADK')

    const decoder = new TextDecoder()
    let buffer = ''

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const lines = part.split('\n')
        let data = ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            data += line.slice(6)
          }
        }
        if (data) {
          try {
            yield JSON.parse(data) as AdkEvent
          } catch {
            // Skip unparseable events
          }
        }
      }
    }
  })
