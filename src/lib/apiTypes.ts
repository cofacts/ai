import type { AdkSession } from './adk'

// ── POST /api/sessions ─────────────────────────────────────────────

export interface CreateSessionRequest {
  session_id: string
}

export interface CreateSessionResponse {
  ok: boolean
}

// ── GET /api/sessions ──────────────────────────────────────────────

export type ListSessionsResponse = AdkSession[]

// ── POST /api/chat ─────────────────────────────────────────────────

export interface ChatRequest {
  app_name: string
  user_id: string
  session_id: string
  streaming: boolean
  new_message?: {
    role: string
    parts: Array<{ text: string }>
  }
  invocation_id?: string
}
// Response is a streaming SSE body — no JSON response type
