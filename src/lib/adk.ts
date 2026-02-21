/**
 * ADK (Agent Development Kit) client utilities.
 *
 * Provides TypeScript types and helpers for communicating with the
 * ADK FastAPI backend running at localhost:8000.
 */

export const ADK_BASE_URL = 'http://localhost:8000'
export const ADK_APP_NAME = 'cofacts-ai'
export const ADK_USER_ID = 'anonymous'

// ── Types ──────────────────────────────────────────────────────────

export interface AdkPart {
  text?: string
  functionCall?: {
    name: string
    args: Record<string, unknown>
  }
  functionResponse?: {
    name: string
    response: Record<string, unknown>
  }
}

export interface AdkContent {
  role: string
  parts: AdkPart[]
}

export interface AdkEvent {
  id?: string
  invocation_id?: string
  author?: string
  content?: AdkContent
  partial?: boolean
  is_final_response?: boolean
  actions?: {
    artifact_delta?: Record<string, unknown>
    state_delta?: Record<string, unknown>
  }
  grounding_metadata?: {
    grounding_chunks?: Array<{
      web?: {
        uri?: string
        title?: string
      }
    }>
    search_entry_point?: {
      rendered_content?: string
    }
  }
  error_code?: string
  error_message?: string
}

export interface AdkSession {
  id: string
  app_name: string
  user_id: string
  state: Record<string, unknown>
  events: AdkEvent[]
}

export interface AdkRunPayload {
  app_name: string
  user_id: string
  session_id: string
  new_message?: {
    role: string
    parts: Array<{ text: string }>
  }
  invocation_id?: string
  streaming?: boolean
}

// ── Chat message types for UI ──────────────────────────────────────

export type MessageRole = 'user' | 'agent'

export interface ToolCall {
  name: string
  args?: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: MessageRole
  author?: string
  text: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
  timestamp?: Date
}

export interface SourceItem {
  url: string
  title: string
  domain: string
  snippet: string
  thumbnailUrl?: string
  faviconUrl?: string
  adopted: boolean
}

// ── SSE Parsing ────────────────────────────────────────────────────

/**
 * Parse a raw SSE text stream into individual event data strings.
 * Each SSE event is separated by a blank line and prefixed with `data: `.
 */
export function parseSseLines(chunk: string): string[] {
  const events: string[] = []
  const lines = chunk.split('\n')
  let currentData = ''

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      currentData += line.slice(6)
    } else if (line === '' && currentData) {
      events.push(currentData)
      currentData = ''
    }
  }

  // Handle case where there's remaining data without trailing newline
  if (currentData) {
    events.push(currentData)
  }

  return events
}

/**
 * Parse a raw SSE event data string into an AdkEvent object.
 */
export function parseAdkEvent(data: string): AdkEvent | null {
  try {
    return JSON.parse(data) as AdkEvent
  } catch {
    console.warn('Failed to parse ADK event:', data)
    return null
  }
}
