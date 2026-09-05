// The report form's server functions: thin RPC wrappers plus their input checks.
//
// The Cofacts calls themselves live in report.queries.ts — the note there says
// why they have to, and why importing them from here is safe.

import { createServerFn } from '@tanstack/react-start'

import {
  fetchReportOutcome,
  fileArticleReport,
  findSimilarReports,
  recordFactCheckRequest,
} from './report.queries'
import type {
  CreateArticleReportInput,
  RequestFactCheckInput,
} from './report.queries'

export type {
  CreateArticleReportInput,
  ReportOutcome,
  ReportOutcomeArticle,
  RequestFactCheckInput,
  SearchCandidate,
  SearchResult,
} from './report.queries'

export const searchSuspiciousMessages = createServerFn({ method: 'GET' })
  .inputValidator((text: string) => {
    const like = text.trim()
    if (!like) throw new Error('Nothing to search for')
    return like
  })
  .handler(({ data: like }) => findSimilarReports(like))

export const getReportOutcomeArticle = createServerFn({ method: 'GET' })
  .inputValidator((articleId: string) => articleId)
  .handler(({ data: articleId }) => fetchReportOutcome(articleId))

export const requestFactCheck = createServerFn({ method: 'POST' })
  .inputValidator((input: RequestFactCheckInput) => {
    if (!input.articleId) throw new Error('articleId is required')
    return input
  })
  .handler(({ data }) => recordFactCheckRequest(data))

export const createArticleReport = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateArticleReportInput) => {
    if (!input.text.trim()) throw new Error('text is required')
    if (!input.permalink) throw new Error('permalink is required')
    return input
  })
  .handler(({ data }) => fileArticleReport(data))
