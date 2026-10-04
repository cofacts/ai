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
  ReportOutcomeArticleQueryVariables,
  SearchSuspiciousMessagesQueryVariables,
} from './gql/graphql'
import type {
  CreateArticleReportInput,
  RequestFactCheckInput,
} from './report.queries'

export type { ReportOutcomeArticle, SearchCandidate } from './report.queries'

export const searchSuspiciousMessages = createServerFn({ method: 'GET' })
  .inputValidator((text: SearchSuspiciousMessagesQueryVariables['like']) => {
    const like = text.trim()
    if (!like) throw new Error('Nothing to search for')
    return like
  })
  .handler(({ data: like }) => findSimilarReports(like))

export const getReportOutcomeArticle = createServerFn({ method: 'GET' })
  .inputValidator(
    (articleId: ReportOutcomeArticleQueryVariables['id']) => articleId,
  )
  .handler(({ data: articleId }) => fetchReportOutcome(articleId))

export const requestFactCheck = createServerFn({ method: 'POST' })
  .inputValidator((input: RequestFactCheckInput) => {
    if (!input.articleId) throw new Error('articleId is required')
    return input
  })
  .handler(({ data }) => recordFactCheckRequest(data))

export const createArticleReport = createServerFn({ method: 'POST' })
  .inputValidator((input: CreateArticleReportInput) => {
    if (!input.url.trim()) throw new Error('url is required')
    return input
  })
  .handler(({ data }) => fileArticleReport(data))
