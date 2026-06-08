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

/** A source URL/title pair included in grounded investigator / verifier responses. */
export type ToolSource = { title: string; url: string }

/**
 * ADK wraps a sub-agent's plain-text output as `{ result: string }` when the
 * text cannot be parsed as JSON — e.g. when Gemini omits grounding metadata
 * and the after-model callback falls back to a retry instruction or raw text.
 */
type AdkFallbackResp = { result: string }

/**
 * Map of all cofacts_ai tool names to their `args` / `resp` shapes.
 *
 * **IMPORTANT:** Keep in strict sync with `adk/cofacts_ai/tools.py` and `agent.py`.
 * - `args` fields are all optional — LLM output may be incomplete.
 * - `resp` fields are non-optional where the Python code guarantees them.
 */
export type AllTools = {
  investigator: {
    args: { request?: string }
    /**
     * Structured response when `google_search` returns grounding metadata.
     * Falls back to `AdkFallbackResp` when Gemini omits grounding metadata
     * intermittently (the callback injects a retry instruction as plain text).
     */
    resp:
      | {
          content: string
          sources: Array<ToolSource>
        }
      | AdkFallbackResp
  }
  verifier: {
    args: { request?: string }
    /**
     * Structured response when `url_context` returns grounding metadata.
     * Falls back to `AdkFallbackResp` when Gemini omits grounding metadata
     * intermittently (the callback returns `None`, leaving raw LLM text).
     */
    resp: { content: string; sources: Array<ToolSource> } | AdkFallbackResp
  }
  proofreader_kmt: { args: { request?: string }; resp: { result: string } }
  proofreader_dpp: { args: { request?: string }; resp: { result: string } }
  proofreader_tpp: { args: { request?: string }; resp: { result: string } }
  proofreader_minor_parties: {
    args: { request?: string }
    resp: { result: string }
  }
  draft_factcheck_response: {
    args: {
      classification?: string
      text?: string
      references?: string
      claim_sources?: Array<{
        claim?: string
        source_url?: string
        verifier_confirmed?: boolean
      }>
    }
    resp: { success: boolean; text: string }
  }
  get_single_cofacts_article: {
    args: { article_id?: string }
    resp: {
      article_id: string
      error?: string
      article?: {
        id: string
        text: string
        createdAt: string
        articleType: string
        attachmentUrl: string | null
        factCheckCount: number
        communityDemandCount: number
        factCheckResponses: Array<{
          reply: {
            id: string
            type: string
            text: string
            createdAt: string
            reference: string
            user: { name: string }
          }
          user: { name: string }
          createdAt: string
          helpfulCount: number
          unhelpfulCount: number
        }>
        relatedArticles: {
          totalCount: number
          edges: Array<{
            node: {
              id: string
              text: string
              articleType: string
              factCheckCount: number
              createdAt: string
              factCheckResponses: Array<{
                reply: { id: string; type: string; text: string }
                helpfulCount: number
                unhelpfulCount: number
              }>
            }
            score: number
          }>
        }
        stats: Array<{
          date: string
          lineUser: number
          lineVisit: number
          webUser: number
          webVisit: number
          downstreamBotUsers: number
          downstreamBotVisits: number
        }>
      } | null
    }
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

/** A single tool call record — discriminated union over all tool names via `name`. `resp` is `null` while the call is still in-flight. */
export type ToolInvocation = {
  [K in keyof AllTools]: {
    id: string
    name: K
    args: AllTools[K]['args']
    resp: AllTools[K]['resp'] | null
  }
}[keyof AllTools]
