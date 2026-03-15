import { runChat } from './sessions.functions'
import type { QueryClient } from '@tanstack/react-query'
import type {
  AdkEvent,
  AdkSession,
  ChatMessage,
  SourceItem,
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
  payload?: {
    newMessage?: { role: string; parts: Array<{ text: string }> }
    invocationId?: string
  }
}

/**
 * Starts an SSE stream for a specific session and updates its state in the TanStack Query cache.
 * Designed to run in the background, independent of React component lifecycles.
 */
export async function startChatStream({
  queryClient,
  sessionId,
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
          role: 'model',
          author: 'writer',
          parts: [],
          isStreaming: true,
          timestamp: new Date(),
        },
      ],
    }
  })

  try {
    const stream = await runChat({
      data: {
        sessionId,
        ...payload,
      },
      signal: controller.signal,
    })

    for await (const event of stream) {
      processEventIntoCache(queryClient, sessionId, event)
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
          parts: [{ text }],
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
      newMessage: {
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

  const eventParts = event.content.parts

  // Logic from processEventIntoCache
  let draftResponse = prev.draftResponse
  let messages = prev.messages
  let sources = prev.sources

  // 1. Writer draft updates
  if (event.author === 'writer' && event.partial) {
    const text = eventParts
      .map((p) => p.text ?? '')
      .filter(Boolean)
      .join('')
    draftResponse += text
  }

  // 2. User history replay deduplication
  if (event.content.role === 'user') {
    const exists = messages.some(
      (m) =>
        m.role === 'user' &&
        JSON.stringify(m.parts) === JSON.stringify(eventParts),
    )
    if (!exists) {
      messages = [
        ...messages,
        {
          id: genId(),
          role: 'user',
          parts: [...eventParts],
          timestamp: new Date(),
        },
      ]
    }
    return { ...prev, messages }
  }

  // 3. Agent parts (text & tool calls)
  if (event.content.role === 'model') {
    const last = messages[messages.length - 1]
    if (
      last.role === 'model' &&
      last.isStreaming &&
      (last.author || 'writer') === (event.author || 'writer')
    ) {
      const updatedParts = [...(last.parts || [])]

      for (const part of eventParts) {
        if (event.partial && part.text) {
          // Streaming text: append to last text part if it exists
          const lastPart = updatedParts[updatedParts.length - 1]
          if (lastPart.text !== undefined) {
            updatedParts[updatedParts.length - 1] = {
              ...lastPart,
              text: lastPart.text + part.text,
            }
          } else {
            updatedParts.push({ ...part })
          }
        } else {
          // Tool calls or final text parts: push as is
          updatedParts.push({ ...part })
        }
      }

      messages = [
        ...messages.slice(0, -1),
        {
          ...last,
          parts: updatedParts,
          isStreaming: event.partial !== false,
        },
      ]
    } else {
      messages = [
        ...messages,
        {
          id: genId(),
          role: 'model',
          author: event.author || 'writer',
          parts: [...eventParts],
          isStreaming: event.partial !== false,
          timestamp: new Date(),
        },
      ]
    }
  }

  // 4. Grounding metadata (Sources)
  if (event.groundingMetadata?.groundingChunks) {
    const newSources: Array<SourceItem> =
      event.groundingMetadata.groundingChunks
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
  for (const event of session.events ?? []) {
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
