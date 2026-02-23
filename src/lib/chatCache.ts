import { ADK_APP_NAME, ADK_USER_ID } from './adk'
import type { QueryClient } from '@tanstack/react-query'
import type {
  AdkEvent,
  AdkSession,
  ChatMessage,
  SourceItem,
  ToolCall,
} from './adk'

export interface ChatSessionState {
  messages: Array<ChatMessage>
  isStreaming: boolean
  error: string | null
  draftResponse: string
  sources: Array<SourceItem>
}

export const INITIAL_CHAT_STATE: ChatSessionState = {
  messages: [],
  isStreaming: false,
  error: null,
  draftResponse: '',
  sources: [],
}

// Global registry of abort controllers per session to prevent duplicate streams
export const abortControllers = new Map<string, AbortController>()

let messageIdCounter = 0
const genId = () => `msg-${++messageIdCounter}-${Date.now()}`

export interface StartStreamOptions {
  queryClient: QueryClient
  sessionId: string
  appName?: string
  userId?: string
  payload?: {
    new_message?: { role: string; parts: Array<{ text: string }> }
    invocation_id?: string
  }
}

/**
 * Starts an SSE stream for a specific session and updates its state in the TanStack Query cache.
 * Designed to run in the background, independent of React component lifecycles.
 */
export async function startChatStream({
  queryClient,
  sessionId,
  appName = ADK_APP_NAME,
  userId = ADK_USER_ID,
  payload = {},
}: StartStreamOptions) {
  const queryKey = ['chat', sessionId]

  // Initialize state if it doesn't exist
  if (!queryClient.getQueryData(queryKey)) {
    queryClient.setQueryData(queryKey, INITIAL_CHAT_STATE)
  }

  // Abort any existing stream for this session
  abortControllers.get(sessionId)?.abort()
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)

  // Set streaming state to true and add a placeholder agent message
  const streamingMsgId = genId()
  queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
    if (!prev) return INITIAL_CHAT_STATE
    return {
      ...prev,
      isStreaming: true,
      error: null,
      messages: [
        ...prev.messages,
        {
          id: streamingMsgId,
          role: 'agent',
          author: 'writer',
          text: '',
          isStreaming: true,
          timestamp: new Date(),
        },
      ],
    }
  })

  try {
    const body = {
      app_name: appName,
      user_id: userId,
      session_id: sessionId,
      streaming: true,
      ...payload,
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(
        `Endpoint returned ${response.status}: ${response.statusText}`,
      )
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

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
            const event = JSON.parse(data) as AdkEvent
            processEventIntoCache(queryClient, sessionId, event)
          } catch {
            // Skip unparseable events
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Expected when a stream is canceled
      return
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
      if (!prev) return INITIAL_CHAT_STATE
      return { ...prev, error: errorMessage }
    })
    console.error(`SSE stream error for session ${sessionId}:`, err)
  } finally {
    // Mark all streaming messages as complete
    queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
      if (!prev) return INITIAL_CHAT_STATE
      return {
        ...prev,
        isStreaming: false,
        messages: prev.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m,
        ),
      }
    })
    if (abortControllers.get(sessionId) === controller) {
      abortControllers.delete(sessionId)
    }
  }
}

/**
 * Sends a message from the user, updating the cache immediately
 * and triggering the background SSE stream.
 */
export function sendChatMessage(
  queryClient: QueryClient,
  sessionId: string,
  text: string,
) {
  const queryKey = ['chat', sessionId]

  if (!queryClient.getQueryData(queryKey)) {
    queryClient.setQueryData(queryKey, INITIAL_CHAT_STATE)
  }

  // Add user message to state
  queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
    if (!prev) return INITIAL_CHAT_STATE
    return {
      ...prev,
      messages: [
        ...prev.messages,
        {
          id: genId(),
          role: 'user',
          text,
          timestamp: new Date(),
        },
      ],
    }
  })

  // Start the background stream
  startChatStream({
    queryClient,
    sessionId,
    payload: {
      new_message: {
        role: 'user',
        parts: [{ text }],
      },
    },
  })
}

/**
 * Applies a single ADK event to the chat session state.
 * Refactored from processEventIntoCache to be pure and reusable.
 */
export function applyEventToState(
  prev: ChatSessionState,
  event: AdkEvent,
): ChatSessionState {
  if (!event.content?.parts) return prev

  const text = event.content.parts
    .map((p) => p.text ?? '')
    .filter(Boolean)
    .join('')

  const toolCalls: Array<ToolCall> = event.content.parts
    .filter((p) => p.functionCall)
    .map((p) => ({
      name: p.functionCall!.name,
      args: p.functionCall!.args,
    }))

  // Logic from processEventIntoCache
  let draftResponse = prev.draftResponse
  let messages = prev.messages
  let sources = prev.sources

  // 1. Writer draft updates
  if (event.author === 'writer' && text && event.partial) {
    draftResponse += text
    return { ...prev, draftResponse }
  }

  // 2. User history replay deduplication
  if (event.content.role === 'user' && text) {
    const exists = messages.some((m) => m.role === 'user' && m.text === text)
    if (!exists) {
      messages = [
        ...messages,
        { id: genId(), role: 'user', text, timestamp: new Date() },
      ]
    }
    return { ...prev, messages }
  }

  // 3. Tool calls
  if (toolCalls.length > 0) {
    const last = messages[messages.length - 1]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (last && last.role === 'agent' && last.isStreaming) {
      messages = [
        ...messages.slice(0, -1),
        {
          ...last,
          toolCalls: [...(last.toolCalls ?? []), ...toolCalls],
        },
      ]
    } else {
      messages = [
        ...messages,
        {
          id: genId(),
          role: 'agent',
          author: event.author ?? 'writer',
          text: '',
          toolCalls,
          isStreaming: true,
          timestamp: new Date(),
        },
      ]
    }
  }

  // 4. Agent text
  if (text && event.content.role === 'model') {
    const last = messages[messages.length - 1]
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      last &&
      last.role === 'agent' &&
      last.isStreaming &&
      (last.author ?? 'writer') === (event.author ?? 'writer')
    ) {
      messages = [
        ...messages.slice(0, -1),
        {
          ...last,
          text: event.partial ? last.text + text : last.text + text,
          isStreaming: event.partial !== false,
        },
      ]
    } else {
      messages = [
        ...messages,
        {
          id: genId(),
          role: 'agent',
          author: event.author ?? 'writer',
          text,
          isStreaming: event.partial !== false,
          timestamp: new Date(),
        },
      ]
    }
  }

  // 5. Grounding metadata (Sources)
  if (event.grounding_metadata?.grounding_chunks) {
    const newSources: Array<SourceItem> =
      event.grounding_metadata.grounding_chunks
        .filter((c) => c.web?.uri)
        .map((c) => {
          const url = c.web!.uri!
          let domain = ''
          try {
            domain = new URL(url).hostname
          } catch {
            domain = url
          }
          return {
            url,
            title: c.web!.title ?? 'Unknown Source',
            domain,
            snippet: '',
            adopted: false,
          }
        })

    if (newSources.length > 0) {
      const existingUrls = new Set(sources.map((s) => s.url))
      const unique = newSources.filter((s) => !existingUrls.has(s.url))
      sources = [...sources, ...unique]
    }
  }

  return { ...prev, messages, draftResponse, sources }
}

/**
 * Converts a full ADK session (with history) into ChatSessionState.
 */
export function convertAdkSessionToChatState(
  session: AdkSession,
): ChatSessionState {
  let state = INITIAL_CHAT_STATE
  for (const event of session.events) {
    state = applyEventToState(state, event)
  }

  // Ensure we are not in streaming state after loading history
  state = {
    ...state,
    isStreaming: false,
    messages: state.messages.map((m) => ({ ...m, isStreaming: false })),
  }
  return state
}

/**
 * Processes a single ADK SSE event directly into the TanStack Query cache.
 */
function processEventIntoCache(
  queryClient: QueryClient,
  sessionId: string,
  event: AdkEvent,
) {
  queryClient.setQueryData<ChatSessionState>(['chat', sessionId], (prev) => {
    if (!prev) return INITIAL_CHAT_STATE
    return applyEventToState(prev, event)
  })
}
