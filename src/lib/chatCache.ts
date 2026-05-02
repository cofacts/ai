import { runChat } from './sessions.functions'
import type { QueryClient } from '@tanstack/react-query'
import type { AdkEvent, AdkSession, ChatMessage, SourceItem } from './adk'

export interface ChatSessionState {
  messages: Array<ChatMessage>
  isStreaming: boolean
  error: string | null
  sources: Array<SourceItem>
  draft: string
}

export const INITIAL_CHAT_STATE: ChatSessionState = {
  messages: [],
  isStreaming: false,
  error: null,
  sources: [],
  draft: '',
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

  // Abort any existing stream for this session
  abortControllers.get(sessionId)?.abort()
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)

  queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
    // Initialize state if it doesn't exist
    if (!prev) return INITIAL_CHAT_STATE

    // Set existing session state's streaming flag and reset errors
    return {
      ...prev,
      isStreaming: true,
      error: null,
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
 * Updates the draft message for a specific session.
 */
export function updateChatDraft(
  queryClient: QueryClient,
  sessionId: string,
  draft: string,
) {
  const queryKey = ['chat', sessionId]
  queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
    if (!prev) return { ...INITIAL_CHAT_STATE, draft }
    return { ...prev, draft }
  })
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
      draft: '',
      messages: [
        ...prev.messages,
        {
          id: genId(),
          role: 'user',
          author: 'user',
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

  // console.info('applyEventToState', event);

  // Skip function responses
  const eventParts = event.content.parts.filter((p) => !p.functionResponse)

  if (event.content.role === 'user') {
    // Don't insert user message if it's just a function response.
    // We may store the map of function response as a separate map when we need tool response in UI.
    if (eventParts.length === 0) return prev

    // event is user message, just append message
    return {
      ...prev,
      messages: [
        ...prev.messages,
        {
          id: genId(),
          role: 'user',
          author: event.author || 'user',
          parts: [...eventParts],
          timestamp: new Date(),
        },
      ],
    }
  }

  let messages = prev.messages

  // Agent parts (text & tool calls)
  if (event.content.role === 'model') {
    const last = messages[messages.length - 1]
    const isLastStillStreaming =
      last?.role === 'model' &&
      last?.isStreaming &&
      (last?.author || 'writer') === (event.author || 'writer')

    if (!isLastStillStreaming) {
      messages = [
        ...messages,
        {
          id: genId(),
          role: 'model',
          author: event.author || 'writer',
          parts: [...eventParts],
          isStreaming: event.partial !== false,
          timestamp: new Date(),
          langfuseTraceId: event.customMetadata?.['langfuse_trace_id'] as
            | string
            | undefined,
        },
      ]
    } else if (!event.partial) {
      // Last event still streaming but not this event, mark last event as not streaming.
      // ADK marks the end of streaming by setting `partial: false` with a full message.
      // However, we have appended the streaming content to the last message in previous iterations,
      // thus we can just reset the isStreaming flag of the previous message and drop this event.

      messages = [
        ...messages.slice(0, -1),
        {
          ...last,
          isStreaming: false,
        },
      ]
    } else {
      // Last event is still streaming and this event still streaming, append to it
      const updatedParts = [...(last.parts || [])]

      for (const part of eventParts) {
        if (!part.text) {
          // Tool calls: push as is
          updatedParts.push({ ...part })
          continue
        }

        // If last part is not a text part, push the text part as a new part
        const lastPart = updatedParts[updatedParts.length - 1]
        if (lastPart?.text === undefined) {
          updatedParts.push({ ...part })
          continue
        }

        // Append the text part to the last text part
        updatedParts[updatedParts.length - 1] = {
          ...lastPart,
          text: lastPart.text + part.text,
        }
      }

      messages = [
        ...messages.slice(0, -1),
        {
          ...last,
          parts: updatedParts,
          isStreaming: true,
        },
      ]
    }
  }

  // Grounding metadata (Sources)
  let sources = prev.sources
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

  return { ...prev, messages, sources }
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
