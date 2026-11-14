import { handleAuthExpired } from './authExpired'
import { UPLOAD_FILENAME_PREFIX } from './adk'
import { getSession, listSessions } from './chatSessions.functions'
import type { SessionListItem } from './chatSessions.functions'
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
  /** session.state.lastEventTime when the history was loaded. */
  lastEventTime?: number
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

/**
 * Open connections per session: a watched background run, or a legacy
 * /api/run-sse stream. One at a time; also tells whether a session is
 * already being watched.
 */
export const abortControllers = new Map<string, AbortController>()
const legacyStreams = new Set<string>()

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

/** Calls onEvent for each `data:` frame of an SSE response body. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AdkEvent) => void,
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
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) data += line.slice(6)
        }
        if (!data) continue
        let event: AdkEvent
        try {
          event = JSON.parse(data) as AdkEvent
        } catch {
          continue // skip unparseable events
        }
        onEvent(event)
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
    lastEventTime: prev.lastEventTime,
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
export async function sendChatMessage(
  queryClient: QueryClient,
  sessionId: string,
  text: string,
  files: Array<File> = [],
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
  void sendParts(queryClient, sessionId, parts)
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

  if (response.status === 503) {
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
    // Another window's run holds the session: watch it instead, and hand
    // the user's draft back.
    setChat(queryClient, sessionId, (prev) => ({
      ...rebuildChatState(prev, prev.historyEvents, null),
      notice: BUSY_NOTICE,
    }))
    void watchRun(queryClient, sessionId)
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
    live: prev.live ? { ...prev.live, invocationId } : prev.live,
  }))
  // Refetch the history too: another window may have added turns since this
  // one last loaded it.
  void watchRun(queryClient, sessionId, { refreshHistory: true })
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

async function fetchRunStatus(
  sessionId: string,
): Promise<{ running: boolean; invocationId: string | null }> {
  const res = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/status`)
  if (res.status === 401) handleAuthExpired()
  if (!res.ok) return { running: false, invocationId: null }
  return res.json()
}

/** Loads the session history and the run status together. */
export async function loadChatState(
  sessionId: string,
): Promise<ChatSessionState> {
  const [session, status] = await Promise.all([
    getSession({ data: sessionId }),
    fetchRunStatus(sessionId).catch(() => ({
      running: false,
      invocationId: null,
    })),
  ])
  const state = convertAdkSessionToChatState(session)
  // A run is going: show it as such until watchRun() attaches, rather than
  // flashing "interrupted" for its unanswered question.
  return status.running
    ? { ...state, isStreaming: true, interrupted: false }
    : state
}

const MAX_REATTACHES = 3

/**
 * Watches the session's background run until it ends, applying its events
 * to the cache. Safe to call when already watching (does nothing).
 *
 * The server replays the run from its first event, then streams the rest,
 * and closes the connection when the run ends. A connection can also drop
 * mid-run (network change, proxy); then the status decides whether to
 * reattach or to reload the history.
 */
export async function watchRun(
  queryClient: QueryClient,
  sessionId: string,
  { refreshHistory = false }: { refreshHistory?: boolean } = {},
) {
  if (abortControllers.has(sessionId)) return
  const controller = new AbortController()
  abortControllers.set(sessionId, controller)
  const isCurrent = () => abortControllers.get(sessionId) === controller

  setChat(queryClient, sessionId, (prev) => ({
    ...prev,
    isStreaming: true,
    error: null,
    interrupted: false,
  }))

  if (refreshHistory) {
    getSession({ data: sessionId })
      .then((session) => {
        if (!isCurrent()) return
        setChat(queryClient, sessionId, (prev) =>
          rebuildChatState(prev, completeEvents(session.events), prev.live),
        )
      })
      .catch((err) => console.error('History refresh failed:', err))
  }

  let reattaches = 0
  try {
    for (;;) {
      // Written from the readSse callback, so not plain `let`s that
      // TypeScript would narrow to their initial values after the await.
      const seen = { first: true, last: null as AdkEvent | null }
      try {
        const response = await fetch(
          `/api/runs/${encodeURIComponent(sessionId)}/stream`,
          { signal: controller.signal },
        )
        if (response.status === 401) handleAuthExpired()
        if (!response.ok || !response.body) {
          throw new Error(`Stream request failed: HTTP ${response.status}`)
        }
        await readSse(response.body, (event) => {
          const first = seen.first
          seen.first = false
          seen.last = event
          setChat(queryClient, sessionId, (prev) => {
            if (first) {
              // The replay starts over from the run's first event.
              return rebuildChatState(prev, prev.historyEvents, {
                invocationId: event.invocationId,
                events: [event],
              })
            }
            return {
              ...applyEventToState(prev, event),
              live: {
                invocationId: event.invocationId,
                events: [...(prev.live?.events ?? []), event],
              },
            }
          })
        })
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn(`Run stream for ${sessionId} dropped:`, err)
      }
      if (!isCurrent()) return

      const last = seen.last
      if (last && isRunEndEvent(last)) {
        finishRun(queryClient, sessionId)
        return
      }
      // Closed without the end in sight: ended just now, the owner died, or
      // the connection dropped.
      const status = await fetchRunStatus(sessionId).catch(() => null)
      if (!isCurrent()) return
      if (status?.running && reattaches < MAX_REATTACHES) {
        reattaches = last ? 0 : reattaches + 1
        if (!last) await new Promise((r) => setTimeout(r, 1000 * reattaches))
        continue
      }
      await reloadHistory(queryClient, sessionId)
      return
    }
  } finally {
    if (isCurrent()) {
      abortControllers.delete(sessionId)
      setChat(queryClient, sessionId, (prev) => ({
        ...prev,
        isStreaming: false,
        messages: prev.messages.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m,
        ),
      }))
      // Refresh session list so lastEventTime (written by agent callback) is picked up immediately.
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }
  }
}

/** The watched run ended normally: its events join the history. */
function finishRun(queryClient: QueryClient, sessionId: string) {
  setChat(queryClient, sessionId, (prev) => {
    const liveId = prev.live?.invocationId
    const historyEvents = [
      ...prev.historyEvents.filter((e) => !liveId || e.invocationId !== liveId),
      ...completeEvents(prev.live?.events),
    ]
    return {
      ...prev,
      historyEvents,
      live: null,
      lastEventTime: undefined,
      interrupted: isTurnInterrupted(historyEvents),
    }
  })
}

async function reloadHistory(queryClient: QueryClient, sessionId: string) {
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

/**
 * Called when the page loads or becomes visible again. Attaches to a run
 * going on (maybe started in another window), or reloads the history when
 * the session changed elsewhere since it was loaded. Never polls.
 */
export async function syncChatSession(
  queryClient: QueryClient,
  sessionId: string,
  { checkHistory = false }: { checkHistory?: boolean } = {},
) {
  if (abortControllers.has(sessionId)) return
  const status = await fetchRunStatus(sessionId)
  if (status.running) {
    void watchRun(queryClient, sessionId, { refreshHistory: checkHistory })
    return
  }
  const state = queryClient.getQueryData<ChatSessionState>(
    chatCacheKey(sessionId),
  )
  if (state?.isStreaming && !abortControllers.has(sessionId)) {
    // loadChatState saw a run that has ended since.
    await reloadHistory(queryClient, sessionId)
    return
  }
  if (!checkHistory) return
  const sessions = await queryClient.fetchQuery<Array<SessionListItem>>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    staleTime: 0,
  })
  const item = sessions.find((s) => s.id === sessionId)
  if (item?.lastEventTime === undefined) return
  if (state?.lastEventTime === undefined) {
    // Watched a run to the end here; just note where the session is now.
    setChat(queryClient, sessionId, (prev) => ({
      ...prev,
      lastEventTime: item.lastEventTime,
    }))
    return
  }
  if (item.lastEventTime > state.lastEventTime) {
    await reloadHistory(queryClient, sessionId)
  }
}

/** The stop button: asks the server to stop the run. */
export async function stopRun(queryClient: QueryClient, sessionId: string) {
  if (legacyStreams.has(sessionId)) {
    abortControllers.get(sessionId)?.abort()
    return
  }
  const res = await fetch(`/api/runs/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
  })
  // On success the run's viewers get the stopped message and the stream
  // closes. 404: it had already ended.
  if (res.status === 404 && !abortControllers.has(sessionId)) {
    await reloadHistory(queryClient, sessionId)
  }
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

    await readSse(response.body!, (event) =>
      setChat(queryClient, sessionId, (prev) => ({
        ...applyEventToState(prev, event),
        historyEvents: event.partial
          ? prev.historyEvents
          : [...prev.historyEvents, event],
        live: null,
      })),
    )
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
  const lastEventTime = session.state?.['lastEventTime']
  return {
    ...rebuildChatState(
      INITIAL_CHAT_STATE,
      completeEvents(session.events),
      null,
    ),
    lastEventTime:
      typeof lastEventTime === 'number' ? lastEventTime : undefined,
  }
}
