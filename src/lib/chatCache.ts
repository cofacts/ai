import { handleAuthExpired } from './authExpired'
import { UPLOAD_FILENAME_PREFIX } from './adk'
import { isRunsDisabled } from './adkRuns'
import { getSession } from './chatSessions.functions'
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
  /**
   * The session's complete (non-partial) events, as the session API returns
   * them, plus those of runs watched to the end. The screen is computed from
   * these and `live`.
   */
  historyEvents: Array<AdkEvent>
  /**
   * The run being watched and every event received for it, partials
   * included. Its events are trusted over the history's: the stream always
   * replays a run from its first event, so `live` replaces that invocation.
   * invocationId is null until the server names the run.
   */
  live: { invocationId: string | null; events: Array<AdkEvent> } | null
  /** One-off message shown above the input. */
  notice: string | null
  /** The last turn ended without an answer and was not stopped by the user. */
  interrupted: boolean
}

export const INITIAL_CHAT_STATE: ChatSessionState = {
  messages: [],
  isStreaming: false,
  error: null,
  toolInvocations: {},
  lastReplyDraftId: null,
  historyEvents: [],
  live: null,
  notice: null,
  interrupted: false,
}

/** customMetadata key the backend sets on the last event of a stopped run. */
export const RUN_END_KEY = 'cofacts_run_end'

export function chatCacheKey(): readonly ['chat']
export function chatCacheKey(sessionId: string): readonly ['chat', string]
export function chatCacheKey(sessionId?: string) {
  return sessionId ? (['chat', sessionId] as const) : (['chat'] as const)
}

/** Legacy /api/run-sse streams per session (background runs off). */
export const abortControllers = new Map<string, AbortController>()
const legacyStreams = new Set<string>()
/**
 * Sessions with a send in flight: between the click and the start request's
 * answer (reading attachments, the request). The feed must not decide the
 * session is idle meanwhile.
 */
const pendingSends = new Set<string>()
/** Stop pressed during a send in flight; carried out once the run starts. */
const pendingStops = new Set<string>()

// Messages are only ever appended or have their last entry updated, so a
// message's position is a stable id: recomputing the screen from events
// (when a stream attaches) gives every message the same key it had, and
// React keeps the rendered messages instead of remounting them.
const positionalId = (messages: Array<ChatMessage>) => `msg-${messages.length}`

/** Text shown when the user sends while another window's run is going. */
export const BUSY_NOTICE =
  '另一個視窗正在處理這個對話，已幫你接上它的進度。你的訊息還沒送出，等它完成後再送一次。'

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

export interface SseFrame {
  /** The `event:` field; "message" when there is none. */
  type: string
  data: string
}

/** Calls onFrame for each frame of an SSE response body (comments skipped). */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
) {
  const reader = body.getReader()
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
        let data = ''
        let type = 'message'
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) data += line.slice(6)
          else if (line.startsWith('event: ')) type = line.slice(7)
        }
        if (!data) continue // heartbeat comments
        onFrame({ type, data })
      }
    }
  } finally {
    reader.cancel()
  }
}

function setChat(
  queryClient: QueryClient,
  sessionId: string,
  update: (prev: ChatSessionState) => ChatSessionState,
) {
  queryClient.setQueryData<ChatSessionState>(chatCacheKey(sessionId), (prev) =>
    update(prev ?? INITIAL_CHAT_STATE),
  )
}

/**
 * Recomputes the screen: the history without the live run's invocation,
 * then the live run's events.
 */
export function rebuildChatState(
  prev: ChatSessionState,
  historyEvents: Array<AdkEvent>,
  live: ChatSessionState['live'],
): ChatSessionState {
  let state: ChatSessionState = {
    ...INITIAL_CHAT_STATE,
    historyEvents,
    live,
    isStreaming: prev.isStreaming,
    error: prev.error,
    notice: prev.notice,
  }
  const liveId = live?.invocationId
  for (const event of historyEvents) {
    if (liveId && event.invocationId === liveId) continue
    state = applyEventToState(state, event)
  }
  state = {
    ...state,
    messages: state.messages.map((m) =>
      m.isStreaming ? { ...m, isStreaming: false } : m,
    ),
  }
  for (const event of live?.events ?? []) {
    state = applyEventToState(state, event)
  }
  return {
    ...state,
    interrupted: !live && isTurnInterrupted(historyEvents),
  }
}

/** True when the event ends a run: the writer's answer, or a stopped run. */
export function isRunEndEvent(event: AdkEvent): boolean {
  if (event.partial) return false
  if (event.customMetadata?.[RUN_END_KEY]) return true
  const parts = event.content?.parts ?? []
  return (
    event.content?.role === 'model' &&
    parts.some((p) => p.text) &&
    !parts.some((p) => p.functionCall)
  )
}

/**
 * Whether the last turn ended without an answer for a reason other than the
 * user pressing stop: a redeploy, the time limit, a crash. The screen then
 * offers to ask again.
 */
export function isTurnInterrupted(events: Array<AdkEvent>): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as AdkEvent
    const end = event.customMetadata?.[RUN_END_KEY]
    if (end) return end === 'interrupted'
    // Stopped through the old /run_sse (the browser closed the connection).
    if (event.errorCode === 'INVOCATION_ABORTED') return false
    if (!event.content?.parts?.length) continue // state-only events
    return !isRunEndEvent(event)
  }
  return false
}

/**
 * Sends a message from the user, updating the cache immediately and starting
 * a background run (or, when the backend has background runs off, the old
 * /api/run-sse stream).
 *
 * Attachments are passed as native File objects and converted to base64
 * inline-data parts here, just before sending.
 *
 * Resolves to false when the message was not sent because another window's
 * run holds the session; the caller should give the user their draft back.
 */
export function sendChatMessage(
  queryClient: QueryClient,
  sessionId: string,
  text: string,
  files: Array<File> = [],
): Promise<boolean> {
  return trackSend(sessionId, () =>
    buildAndSend(queryClient, sessionId, text, files),
  )
}

async function buildAndSend(
  queryClient: QueryClient,
  sessionId: string,
  text: string,
  files: Array<File>,
): Promise<boolean> {
  // Set isStreaming:true before any async work so that components mounting
  // during file reading (e.g. after navigate()) don't see isStreaming:false
  // and trigger other state changes like markSessionOpened.
  setChat(queryClient, sessionId, (prev) => ({
    ...prev,
    isStreaming: true,
    error: null,
    notice: null,
    interrupted: false,
  }))

  // Build the message parts: text first (when present), then one inline-data
  // part per attachment.
  const parts: Array<AdkPart> = []
  if (text) parts.push({ text })
  if (files.length > 0) {
    parts.push(...(await Promise.all(files.map(fileToInlineDataPart))))
  }
  return sendParts(queryClient, sessionId, parts)
}

/** Marks a send in flight until `send` has attached (or failed). */
async function trackSend<T>(sessionId: string, send: () => Promise<T>) {
  pendingSends.add(sessionId)
  try {
    return await send()
  } finally {
    pendingSends.delete(sessionId)
    pendingStops.delete(sessionId)
  }
}

/** Sends the last user message of an interrupted turn again. */
export function retryInterruptedTurn(
  queryClient: QueryClient,
  sessionId: string,
) {
  const state = queryClient.getQueryData<ChatSessionState>(
    chatCacheKey(sessionId),
  )
  const lastUser = state?.historyEvents
    .slice()
    .reverse()
    .find((e) => e.content?.role === 'user' && e.author === 'user')
  const parts = (lastUser?.content?.parts ?? []).filter(
    (p) =>
      !p.functionResponse &&
      !(p.text && ARTIFACT_PLACEHOLDER.test(p.text.trim())),
  )
  if (parts.length === 0) return
  setChat(queryClient, sessionId, (prev) => ({
    ...prev,
    isStreaming: true,
    error: null,
    notice: null,
    interrupted: false,
  }))
  void trackSend(sessionId, () => sendParts(queryClient, sessionId, parts))
}

async function sendParts(
  queryClient: QueryClient,
  sessionId: string,
  parts: Array<AdkPart>,
): Promise<boolean> {
  const newMessage = { role: 'user', parts }

  // Shown right away; replaced by the stored message when the run's stream
  // replays it.
  const optimistic = {
    invocationId: '',
    author: 'user',
    content: newMessage,
  } as AdkEvent
  setChat(queryClient, sessionId, (prev) => ({
    ...applyEventToState(prev, optimistic),
    live: { invocationId: null, events: [optimistic] },
  }))

  let response: Response
  try {
    response = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newMessage }),
    })
  } catch (err) {
    failStream(queryClient, sessionId, err)
    return true
  }

  if (await isRunsDisabled(response)) {
    if (pendingStops.has(sessionId)) {
      // Stopped before anything ran: just don't start.
      setChat(queryClient, sessionId, (prev) => ({
        ...rebuildChatState(prev, prev.historyEvents, null),
        isStreaming: false,
      }))
      return true
    }
    // Background runs are off (no Redis): the old stream, tied to this tab.
    void startChatStream({
      queryClient,
      sessionId,
      payload: { newMessage },
    })
    return true
  }
  if (response.status === 401) {
    handleAuthExpired()
    failStream(queryClient, sessionId, new Error('Authentication required'))
    return true
  }

  if (response.status === 409) {
    // Another window's run holds the session; the feed shows it. Hand the
    // user's draft back.
    setChat(queryClient, sessionId, (prev) => ({
      ...rebuildChatState(
        prev,
        prev.historyEvents,
        prev.live?.events.some((e) => !e.invocationId) ? null : prev.live,
      ),
      notice: BUSY_NOTICE,
    }))
    return false
  }

  if (!response.ok) {
    failStream(
      queryClient,
      sessionId,
      new Error(`ADK request failed: HTTP ${response.status}`),
    )
    return true
  }

  const { invocationId } = (await response.json()) as {
    invocationId: string | null
  }
  setChat(queryClient, sessionId, (prev) => ({
    ...prev,
    live:
      prev.live && !prev.live.invocationId
        ? { ...prev.live, invocationId }
        : prev.live,
  }))
  // The run's events, starting with the stored message, come on the feed.
  if (pendingStops.has(sessionId)) void requestCancel(sessionId)
  return true
}

function failStream(queryClient: QueryClient, sessionId: string, err: unknown) {
  console.error(`Run error for session ${sessionId}:`, err)
  const message = err instanceof Error ? err.message : 'Unknown error'
  setChat(queryClient, sessionId, (prev) => ({
    ...rebuildChatState(prev, prev.historyEvents, null),
    isStreaming: false,
    error: message,
  }))
}

/**
 * Open /events feeds, counted per session: several components can show the
 * same session, and the feed closes when the last one goes away.
 */
const feeds = new Map<string, { refs: number; controller: AbortController }>()

/**
 * Keeps the session's live feed open while `close` hasn't been called.
 *
 * The feed (`GET /api/runs/:id/events`) sends the stored events, then every
 * run as it happens, from this window or any other, and never ends by
 * itself. When the connection drops it reconnects with `since`, the last
 * stored event it has, so only what's new comes again.
 */
export function connectSessionEvents(
  queryClient: QueryClient,
  sessionId: string,
): () => void {
  const existing = feeds.get(sessionId)
  if (existing) {
    existing.refs++
  } else {
    const controller = new AbortController()
    feeds.set(sessionId, { refs: 1, controller })
    void runFeed(queryClient, sessionId, controller.signal)
  }
  let closed = false
  return () => {
    if (closed) return
    closed = true
    const feed = feeds.get(sessionId)
    if (!feed) return
    if (--feed.refs > 0) return
    feeds.delete(sessionId)
    feed.controller.abort()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runFeed(
  queryClient: QueryClient,
  sessionId: string,
  signal: AbortSignal,
) {
  // A function, not `signal.aborted` inline: it changes while awaiting, and
  // TypeScript would narrow the property to its value at the loop check.
  const aborted = () => signal.aborted
  let failures = 0
  while (!aborted()) {
    const state = queryClient.getQueryData<ChatSessionState>(
      chatCacheKey(sessionId),
    )
    const since = state?.historyEvents.at(-1)?.id
    // Per connection: the first run frame starts the replay of the run in
    // progress, which replaces what this window had for it.
    const conn = { fresh: true }
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(sessionId)}/events` +
          (since ? `?since=${encodeURIComponent(since)}` : ''),
        { signal },
      )
      if (response.status === 401) {
        handleAuthExpired()
        return
      }
      if (await isRunsDisabled(response)) {
        // No Redis: no live feed. Load the history once; sends use the old
        // /api/run-sse stream, tied to this tab.
        await loadHistoryOnce(queryClient, sessionId)
        return
      }
      if (response.status === 404) {
        failStream(queryClient, sessionId, new Error('Session not found'))
        return
      }
      if (!response.ok || !response.body) {
        throw new Error(`Feed request failed: HTTP ${response.status}`)
      }
      await readSse(response.body, (frame) =>
        applyFrame(queryClient, sessionId, frame, conn),
      )
      failures = 0 // closed by the server or a proxy (e.g. Cloud Run's timeout)
    } catch (err) {
      if (aborted()) return
      failures++
      console.warn(`Feed for ${sessionId} dropped:`, err)
    }
    if (aborted()) return
    await sleep(failures ? Math.min(1000 * 2 ** failures, 15_000) : 500)
  }
}

function applyFrame(
  queryClient: QueryClient,
  sessionId: string,
  frame: SseFrame,
  conn: { fresh: boolean },
) {
  switch (frame.type) {
    case 'history': {
      const event = parseEvent(frame.data)
      if (!event) return
      setChat(queryClient, sessionId, (prev) =>
        rebuildChatState(prev, withEvent(prev.historyEvents, event), prev.live),
      )
      return
    }
    case 'synced': {
      const { running } = JSON.parse(frame.data) as { running: boolean }
      if (running) {
        setChat(queryClient, sessionId, (prev) => ({
          ...prev,
          isStreaming: true,
          interrupted: false,
        }))
        return
      }
      // Nothing running: drop what this window still had as live (a run that
      // ended while it was disconnected), unless its own send is on the way.
      if (pendingSends.has(sessionId)) return
      setChat(queryClient, sessionId, (prev) => ({
        ...rebuildChatState(prev, prev.historyEvents, null),
        isStreaming: false,
      }))
      return
    }
    case 'end': {
      setChat(queryClient, sessionId, (prev) => ({
        ...rebuildChatState(prev, prev.historyEvents, null),
        // This window may already be sending the next message.
        isStreaming: pendingSends.has(sessionId),
      }))
      // Refresh session list so lastEventTime (written by agent callback) is picked up immediately.
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      return
    }
    case 'message': {
      const event = parseEvent(frame.data)
      if (!event) return
      const fresh = conn.fresh
      conn.fresh = false
      setChat(queryClient, sessionId, (prev) => {
        const historyEvents = event.partial
          ? prev.historyEvents
          : withEvent(prev.historyEvents, event)
        const live = prev.live
        const startsRun =
          fresh ||
          !live ||
          live.invocationId !== event.invocationId ||
          // The optimistic message of this window's own send.
          live.events.some((e) => !e.invocationId)
        if (startsRun) {
          return {
            ...rebuildChatState(prev, historyEvents, {
              invocationId: event.invocationId,
              events: [event],
            }),
            isStreaming: true,
            interrupted: false,
          }
        }
        return {
          ...applyEventToState(prev, event),
          historyEvents,
          isStreaming: true,
          live: { ...live, events: [...live.events, event] },
        }
      })
      return
    }
  }
}

function parseEvent(data: string): AdkEvent | null {
  try {
    return JSON.parse(data) as AdkEvent
  } catch {
    return null
  }
}

/**
 * Adds a complete event to the history once (by its id), in time order.
 * The same event can arrive stored and again from a run's replay, and a
 * run's catch-up after its end can bring an event from its middle.
 */
function withEvent(history: Array<AdkEvent>, event: AdkEvent) {
  if (event.id && history.some((e) => e.id === event.id)) return history
  const next = [...history, event]
  if (
    history.length &&
    (event.timestamp ?? 0) < (history.at(-1)?.timestamp ?? 0)
  ) {
    next.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  }
  return next
}

async function loadHistoryOnce(queryClient: QueryClient, sessionId: string) {
  try {
    const session = await getSession({ data: sessionId })
    setChat(queryClient, sessionId, (prev) => ({
      ...convertAdkSessionToChatState(session),
      notice: prev.notice,
    }))
  } catch (err) {
    failStream(queryClient, sessionId, err)
  }
}

/** The stop button: asks the server to stop the run. */
export async function stopRun(sessionId: string) {
  if (legacyStreams.has(sessionId)) {
    abortControllers.get(sessionId)?.abort()
    return
  }
  if (pendingSends.has(sessionId)) {
    // The run has no lock yet, so a cancel now would find nothing.
    pendingStops.add(sessionId)
    return
  }
  // The feed then shows the stopped message and the run's end. 404: it had
  // already ended.
  await requestCancel(sessionId)
}

function requestCancel(sessionId: string) {
  return fetch(`/api/runs/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
  })
}

function completeEvents(events: Array<AdkEvent> | undefined) {
  return (events ?? []).filter((e) => !e.partial && e.invocationId)
}

export interface StartStreamOptions {
  queryClient: QueryClient
  sessionId: string
  payload?: {
    newMessage?: { role: string; parts: Array<AdkPart> }
  }
}

/**
 * The old way, kept for when the backend has no Redis: streams ADK's
 * /run_sse, whose run lives only as long as this connection.
 */
export async function startChatStream({
  queryClient,
  sessionId,
  payload = {},
}: StartStreamOptions) {
  // Abort any existing stream for this session
  abortControllers.get(sessionId)?.abort()
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)
  legacyStreams.add(sessionId)

  setChat(queryClient, sessionId, (prev) => ({
    ...prev,
    isStreaming: true,
    error: null,
  }))

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

    await readSse(response.body!, (frame) => {
      const event = parseEvent(frame.data)
      if (!event) return
      setChat(queryClient, sessionId, (prev) => ({
        ...applyEventToState(prev, event),
        historyEvents: event.partial
          ? prev.historyEvents
          : [...prev.historyEvents, event],
        live: null,
      }))
    })
  } catch (err) {
    if (controller.signal.aborted) {
      return
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    setChat(queryClient, sessionId, (prev) => ({
      ...prev,
      error: errorMessage,
    }))
    console.error(`SSE stream error for session ${sessionId}:`, err)
  } finally {
    // Mark all streaming messages as complete.
    // Guard against the race where a new stream has already started for this
    // session (e.g. the user sent a new message while this one was streaming):
    // in that case the new stream owns the state and we must not reset it.
    setChat(queryClient, sessionId, (prev) => {
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
      legacyStreams.delete(sessionId)
      // Refresh session list so lastEventTime (written by agent callback) is picked up immediately.
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  }
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
          id: positionalId(prev.messages),
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
          id: positionalId(messages),
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
 * Converts a full ADK session (with history) into ChatSessionState.
 */
export function convertAdkSessionToChatState(
  session: AdkSession,
): ChatSessionState {
  return rebuildChatState(
    INITIAL_CHAT_STATE,
    completeEvents(session.events),
    null,
  )
}
