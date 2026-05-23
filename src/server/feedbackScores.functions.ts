import { createServerFn } from '@tanstack/react-start'
import { resolveAdkUserIdOrThrow } from './adkUser'

const SCORE_NAME = 'user-thumbs'

export interface FeedbackScore {
  value: 1 | -1 | null
  comment: string | null
}

function langfuseUpstreamFailed(status: number, statusText: string): Error {
  return new Error(`Langfuse upstream failed: ${status} ${statusText}`)
}

interface LangfuseScore {
  id: string
  name: string
  value?: number
  comment?: string | null
  metadata?: unknown
  createdAt?: string
  updatedAt?: string
}

interface LangfuseScoresResponse {
  data?: Array<LangfuseScore>
}

export function normalizeValue(raw: number | undefined): 1 | -1 | null {
  if (raw === 1) return 1
  if (raw === -1) return -1
  return null
}

export function pickLatest(
  scores: Array<LangfuseScore>,
): LangfuseScore | null {
  return scores.reduce<LangfuseScore | null>((acc, score) => {
    if (!acc) return score
    const accTime = acc.updatedAt ?? acc.createdAt ?? ''
    const curTime = score.updatedAt ?? score.createdAt ?? ''
    return curTime > accTime ? score : acc
  }, null)
}

export async function fetchFeedbackForTrace(
  traceId: string,
  userId: string,
): Promise<FeedbackScore> {
  const baseUrl = process.env.LANGFUSE_BASE_URL
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!baseUrl || !publicKey || !secretKey) {
    return { value: null, comment: null }
  }

  const url = new URL('/api/public/v2/scores', baseUrl)
  url.searchParams.set('traceId', traceId)
  url.searchParams.set('name', SCORE_NAME)
  // userId filters server-side by trace.userId; requires 'trace' in fields
  // per Langfuse v2 API contract.
  url.searchParams.set('userId', userId)
  url.searchParams.set('fields', 'scores,trace')
  url.searchParams.set('limit', '50')

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!response.ok) {
    throw langfuseUpstreamFailed(response.status, response.statusText)
  }
  const body = (await response.json()) as LangfuseScoresResponse

  const latest = pickLatest(body.data ?? [])
  if (!latest) return { value: null, comment: null }
  return {
    value: normalizeValue(latest.value),
    comment: latest.comment ?? null,
  }
}

export const getFeedbackForTrace = createServerFn({ method: 'GET' })
  .inputValidator((traceId: string) => traceId)
  .handler(async ({ data: traceId }): Promise<FeedbackScore> => {
    const userId = await resolveAdkUserIdOrThrow()
    return await fetchFeedbackForTrace(traceId, userId)
  })

export interface SubmitFeedbackInput {
  traceId: string
  value: 1 | -1 | 0
  comment?: string
}

export async function postFeedbackForTrace(
  input: SubmitFeedbackInput,
): Promise<void> {
  const baseUrl = process.env.LANGFUSE_BASE_URL
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!baseUrl || !publicKey || !secretKey) return

  const url = new URL('/api/public/scores', baseUrl)
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
  // Deterministic id makes repeated submissions for the same trace upsert
  // (Langfuse merges scores by id within the project), so toggling thumbs
  // overwrites the previous value instead of accumulating duplicates.
  const body: Record<string, unknown> = {
    id: `user-${input.traceId}`,
    traceId: input.traceId,
    name: SCORE_NAME,
    value: input.value,
    dataType: 'NUMERIC',
  }
  if (input.comment !== undefined) body.comment = input.comment

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw langfuseUpstreamFailed(response.status, response.statusText)
  }
}

export const submitFeedbackForTrace = createServerFn({ method: 'POST' })
  .inputValidator((raw: SubmitFeedbackInput) => raw)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    // Re-resolve identity per submission so an expired cookie/JWT triggers
    // a 401 here instead of silently posting under a stale user id.
    await resolveAdkUserIdOrThrow()
    await postFeedbackForTrace(data)
    return { ok: true }
  })
