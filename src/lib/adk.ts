/**
 * ADK (Agent Development Kit) client utilities.
 *
 * Provides TypeScript types and helpers for communicating with the
 * ADK FastAPI backend running at localhost:8000.
 */

export const ADK_BASE_URL = 'http://localhost:8000'
export const ADK_APP_NAME = 'cofacts_ai'
export const ADK_USER_ID = 'anonymous'

import type { components } from './adk-types'

// ── Types from OpenAPI Spec ────────────────────────────────────────

// We re-export these from the generated OpenAPI types so the UI code
// doesn't have to change, but they stay perfectly in sync with ADK.

export type AdkPart = components['schemas']['Part-Output']
export type AdkContent = components['schemas']['Content-Output']
export type AdkEvent = components['schemas']['Event-Output']
export type AdkSession = components['schemas']['Session']
export type AdkRunPayload = components['schemas']['RunAgentRequest']

// ── Chat message types for UI ──────────────────────────────────────

export type MessageRole = 'user' | 'model'

export interface ToolCall {
  name: string
  args?: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: MessageRole
  author?: string
  text: string
  toolCalls?: Array<ToolCall>
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
export function parseSseLines(chunk: string): Array<string> {
  const events: Array<string> = []
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
