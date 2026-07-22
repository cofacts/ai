import { handleAuthExpired } from './authExpired'
import { UPLOAD_FILENAME_PREFIX } from './adk'
import type { QueryClient } from '@tanstack/react-query'
import type {
  AdkEvent,
  AdkPart,
  AdkSession,
  ChatMessage,
  ToolInvocation,
} from './adk'

export interface ChatSessionState {
  messages: Array<ChatMessage>
  isStreaming: boolean
  error: string | null
  toolInvocations: Record<string, ToolInvocation>
  lastReplyDraftId: string | null
}

export const INITIAL_CHAT_STATE: ChatSessionState = {
  messages: [],
  isStreaming: false,
  error: null,
  toolInvocations: {},
  lastReplyDraftId: null,
}

export function chatCacheKey(): readonly ['chat']
export function chatCacheKey(sessionId: string): readonly ['chat', string]
export function chatCacheKey(sessionId?: string) {
  return sessionId ? (['chat', sessionId] as const) : (['chat'] as const)
}

// Global registry of abort controllers per session to prevent duplicate streams
export const abortControllers = new Map<string, AbortController>()

let messageIdCounter = 0
const genId = () => `msg-${++messageIdCounter}-${Date.now()}`

export interface StartStreamOptions {
  queryClient: QueryClient
  sessionId: string
  payload?: {
    newMessage?: { role: string; parts: Array<AdkPart> }
    invocationId?: string
  }
}

/**
 * Reads a browser File into an ADK inline-data part (base64).
 *
 * Conversion happens here — as late as possible, right before the message is
 * sent — so the composer only ever holds native File objects, not large base64
 * strings. The backend's SaveFilesAsArtifactsPlugin turns this inline data into
 * a gs:// fileData reference in the artifact store.
 */
export function fileToInlineDataPart(file: File): Promise<AdkPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // readAsDataURL yields "data:<mime>;base64,<data>" — strip the prefix to
      // keep just the base64 payload. The browser does the encoding natively
      // and asynchronously, avoiding a UI-blocking byte-by-byte loop on large
      // files.
      const result = reader.result as string
      resolve({
        inlineData: {
          data: result.slice(result.indexOf(',') + 1),
          mimeType: file.type || 'application/octet-stream',
          displayName: UPLOAD_FILENAME_PREFIX + file.name,
        },
      })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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
  const queryKey = chatCacheKey(sessionId)

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
    const response = await fetch('/api/run-sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ sessionId, ...payload }),
    })

    if (!response.ok) {
      if (response.status === 401) {
        handleAuthExpired()
      }
      throw new Error(`ADK request failed: HTTP ${response.status}`)
    }

    // Parse the ADK SSE stream directly from response.body.
    // Unlike the old runChat server function approach, fetch's reader.read() throws
    // AbortError immediately when controller.abort() is called — no intermediate
    // layer to swallow it.
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
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
              processEventIntoCache(
                queryClient,
                sessionId,
                JSON.parse(data) as AdkEvent,
              )
            } catch {
              // Skip unparseable events
            }
          }
        }
      }
    } finally {
      reader.cancel()
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
      if (!prev) return INITIAL_CHAT_STATE
      return { ...prev, error: errorMessage }
    })
    console.error(`SSE stream error for session ${sessionId}:`, err)
  } finally {
    // Mark all streaming messages as complete.
    // Guard against the race where a new stream has already started for this
    // session (e.g. the user sent a new message while this one was streaming):
    // in that case the new stream owns the state and we must not reset it.
    queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => {
      if (!prev) return INITIAL_CHAT_STATE
      if (abortControllers.get(sessionId) !== controller) return prev
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
      // Refresh session list so lastEventTime (written by agent callback) is picked up immediately.
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  }
}

/**
 * Sends a message from the user, updating the cache immediately
 * and triggering the background SSE stream.
 *
 * Attachments are passed as native File objects and converted to base64
 * inline-data parts here, just before sending.
 */
export async function sendChatMessage(
  queryClient: QueryClient,
  sessionId: string,
  text: string,
  files: Array<File> = [],
) {
  const queryKey = chatCacheKey(sessionId)

  // Set isStreaming:true before any async work so that components mounting
  // during file reading (e.g. after navigate()) don't see isStreaming:false
  // and trigger other state changes like markSessionOpened.
  queryClient.setQueryData<ChatSessionState>(queryKey, (prev) => ({
    ...(prev ?? INITIAL_CHAT_STATE),
    isStreaming: true,
    error: null,
  }))

  // Build the message parts: text first (when present), then one inline-data
  // part per attachment.
  const parts: Array<AdkPart> = []
  if (text) parts.push({ text })
  if (files.length > 0) {
    parts.push(...(await Promise.all(files.map(fileToInlineDataPart))))
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
          author: 'user',
          parts,
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
        parts,
      },
    },
  })
}

/**
 * SaveFilesAsArtifactsPlugin inserts a standalone text part whose entire
 * content is this placeholder — the file is already shown via AttachmentPart.
 */
const ARTIFACT_PLACEHOLDER = /^\[Uploaded Artifact: ".*"\]$/

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

  // Build toolInvocations from functionCall and functionResponse parts
  const toolInvocations = { ...prev.toolInvocations }
  let lastReplyDraftId = prev.lastReplyDraftId

  for (const part of event.content.parts) {
    // Skip partial events: ADK assigns a fresh adk-<uuid> to every event via
    // populate_client_function_call_id(), so partial and complete events get
    // different IDs for the same call. Only the complete event's ID matches the
    // session history and the incoming functionResponse.
    if (part.functionCall?.id && event.partial !== true) {
      const { id, name, args } = part.functionCall
      if (id && name) {
        toolInvocations[id] = {
          ...toolInvocations[id],
          id,
          name,
          args: (args ?? {}) as ToolInvocation['args'],
          resp: toolInvocations[id]?.resp ?? null,
        } as ToolInvocation
      }
    }
    if (part.functionResponse) {
      const key = part.functionResponse.id ?? part.functionResponse.name
      if (key && toolInvocations[key]) {
        const response = (part.functionResponse.response ??
          null) as ToolInvocation['resp']
        toolInvocations[key] = {
          ...toolInvocations[key],
          resp: response,
        } as ToolInvocation
        // Only pop the drawer for a SUCCESSFUL proposal: draft_factcheck_response
        // is re-callable (cofacts/ai#117), so a gate-rejected call (missing
        // sources, unconfirmed claims, etc.) must not overwrite a prior good
        // draft as "the" one auto-shown when the turn ends.
        if (
          toolInvocations[key].name === 'draft_factcheck_response' &&
          (response as { success?: boolean } | null)?.success === true
        ) {
          lastReplyDraftId = key
        }
      }
    }
  }

  // Exclude function response parts from chat messages
  const eventParts = event.content.parts.filter((p) => !p.functionResponse)

  if (event.content.role === 'user') {
    // Strip artifact placeholder parts inserted by SaveFilesAsArtifactsPlugin —
    // the file is already present as a fileData part rendered by AttachmentPart.
    const userParts = eventParts.filter(
      (p) => !p.text || !ARTIFACT_PLACEHOLDER.test(p.text.trim()),
    )

    // Don't insert user message if it's just function responses / placeholders
    if (userParts.length === 0)
      return { ...prev, toolInvocations, lastReplyDraftId }

    // event is user message, just append message
    return {
      ...prev,
      toolInvocations,
      lastReplyDraftId,
      messages: [
        ...prev.messages,
        {
          id: genId(),
          role: 'user',
          author: event.author || 'user',
          parts: [...userParts],
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
      last.isStreaming &&
      (last.author || 'writer') === (event.author || 'writer')

    if (!isLastStillStreaming) {
      messages = [
        ...messages,
        {
          id: genId(),
          role: 'model',
          author: event.author || 'writer',
          // Partial events carry ephemeral adk-<uuid> IDs; exclude functionCall parts and
          // wait for the canonical IDs from the complete event (handled in else-if branch).
          // Complete events (including history replay) already have canonical IDs — include all.
          parts:
            event.partial === true
              ? eventParts.filter((p) => !p.functionCall)
              : eventParts,
          isStreaming: event.partial === true,
          timestamp: new Date(),
          langfuseTraceId: event.customMetadata?.['langfuse_trace_id'] as
            | string
            | undefined,
        },
      ]
    } else if (!event.partial) {
      // Last event still streaming but not this event, mark last event as not streaming.
      // ADK marks the end of streaming by setting `partial: false` with a full message.
      // The streaming content was appended to the last message in previous iterations.
      // We also append any functionCall parts now: we skipped them during partial events
      // so that only the canonical adk-<uuid> IDs (from this complete event) are used.
      const canonicalFCParts = eventParts.filter((p) => p.functionCall)
      const updatedParts = [...(last.parts ?? []), ...canonicalFCParts]

      messages = [
        ...messages.slice(0, -1),
        {
          ...last,
          parts: updatedParts,
          isStreaming: false,
        },
      ]
    } else {
      // Last event is still streaming and this event still streaming, append to it
      const updatedParts = [...(last.parts || [])]

      for (const part of eventParts) {
        if (!part.text) {
          if (part.functionCall) continue // ephemeral ID; canonical version added on complete event
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

  return { ...prev, messages, toolInvocations, lastReplyDraftId }
}

/**
 * 1-indexed submission order of every `draft_factcheck_response` call in this
 * session, keyed by function-call id (1 = first proposal). Matches the
 * backend's `[[draft:vN]]` versioning (agent.py `expand_writer_symbols`) --
 * both derive from the same chronological order of draft proposals, so a
 * version number shown on screen means the same thing if a user tells the
 * writer to review an earlier one (cofacts/ai#117).
 *
 * A call with no `text` arg is skipped, matching the backend's
 * `_writer_draft_texts` (which only counts calls with a truthy `text`) --
 * keeping both sides in sync even in the degenerate case of an empty draft.
 */
export function getDraftVersionsById(
  messages: Array<ChatMessage>,
): Record<string, number> {
  const versions: Record<string, number> = {}
  let count = 0
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (
        part.functionCall?.name === 'draft_factcheck_response' &&
        part.functionCall.id &&
        part.functionCall.args?.text
      ) {
        count += 1
        versions[part.functionCall.id] = count
      }
    }
  }
  return versions
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
  queryClient.setQueryData<ChatSessionState>(
    chatCacheKey(sessionId),
    (prev) => {
      if (!prev) return INITIAL_CHAT_STATE
      return applyEventToState(prev, event)
    },
  )
}
