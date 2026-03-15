/**
 * ADK (Agent Development Kit) shared utilities and types.
 *
 * This file is safe to import on both the client and the server.
 * It primarily re-exports types from the generated OpenAPI spec.
 */

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
