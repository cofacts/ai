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

export interface ChatMessage extends AdkContent {
  id: string
  author?: string
  isStreaming?: boolean
  timestamp?: Date
  langfuseTraceId?: string
}

// ── cofacts_ai tool types ──────────────────────────────────────────
// IMPORTANT: Keep in strict sync with adk/cofacts_ai/tools.py and agent.py.
// args fields are all optional — LLM output may be incomplete.
// resp fields are non-optional where the Python code guarantees them.

export type AllTools = {
  investigator: {
    args: { request?: string }
    resp: {
      content: string
      sources: Array<{ title: string; url: string }>
      grounding_supports: Array<{
        segment: { start_index: number; end_index: number; text: string }
        source_ids: number[]
      }>
    }
  }
  verifier: {
    args: { request?: string }
    resp: { content: string; sources: Array<{ title: string; url: string }> }
  }
  proofreader_kmt: { args: { request?: string }; resp: { result: string } }
  proofreader_dpp: { args: { request?: string }; resp: { result: string } }
  proofreader_tpp: { args: { request?: string }; resp: { result: string } }
  proofreader_minor_parties: { args: { request?: string }; resp: { result: string } }
  draft_factcheck_response: {
    args: { classification?: string; text?: string; references?: string }
    resp: { success: boolean; text: string }
  }
}

type AdkCallBase = Omit<components['schemas']['FunctionCall'], 'name' | 'args'>
type AdkResponseBase = Omit<
  components['schemas']['FunctionResponse-Output'],
  'name' | 'response'
>

export type FunctionCall =
  | {
      [K in keyof AllTools]: AdkCallBase & {
        name: K
        args?: AllTools[K]['args'] | null
      }
    }[keyof AllTools]
  | components['schemas']['FunctionCall']

export type FunctionResponseOutput =
  | {
      [K in keyof AllTools]: AdkResponseBase & {
        name: K
        response: AllTools[K]['resp']
      }
    }[keyof AllTools]
  | components['schemas']['FunctionResponse-Output']

// ── FocusedTool ───────────────────────────────────────────────────
// Pairs name + args + response under one discriminant so switch(tool.name)
// narrows all three simultaneously. No catch-all: discriminated union only.

export type FocusedTool = {
  [K in keyof AllTools]: {
    name: K
    args: AllTools[K]['args']
    response: AllTools[K]['resp'] | null
  }
}[keyof AllTools]

export interface SourceItem {
  url: string
  title: string
  domain: string
  snippet: string
  thumbnailUrl?: string
  faviconUrl?: string
  adopted: boolean
}
