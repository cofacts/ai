// The report form's four Cofacts calls: search, read, +1, file.
//
// Server-only, and split from report.functions.ts for a mechanical reason: an
// exported plain function is a tree-shaking root, so exporting these from the
// module the route imports would drag `cofactsExec` — and h3's getCookie with
// it — into the client bundle. The createServerFn wrappers next door have
// their handler bodies stripped for the client, which drops this import too.
//
// All of them go through cofactsExec, which attaches the reporter's own JWT from
// the HttpOnly session cookie and the RUMORS_SITE app id — so what lands in
// Cofacts is attributed to the person who filed it, and this app never handles a
// token itself.
//
// Search does not require a session (looking is free); the two writes do, and
// resolveAdkUserIdOrThrow rejects them before any request reaches rumors-api.

import { getArticleUrl } from './cofactsSite'
import { graphql } from './gql'
import { resolveAdkUserIdOrThrow } from './adkUser'
import type {
  ReportOutcomeArticleQuery,
  SearchSuspiciousMessagesQuery,
} from './gql/graphql'
import { isJustLinks } from '@/lib/report'
import { cofactsExec } from '@/lib/cofactsExec'

/**
 * Candidates to show the reporter, so they can say "yes, that's the one" rather
 * than filing a duplicate.
 */
const SearchSuspiciousMessagesDocument = graphql(`
  query SearchSuspiciousMessages(
    $like: String!
    $first: Int!
    $minimumShouldMatch: String
  ) {
    ListArticles(
      filter: {
        moreLikeThis: { like: $like, minimumShouldMatch: $minimumShouldMatch }
      }
      orderBy: [{ _score: DESC }]
      first: $first
    ) {
      totalCount
      edges {
        score
        node {
          id
          text
          articleType
          createdAt
          replyCount
          replyRequestCount
        }
      }
    }
  }
`)

const ReportOutcomeArticleDocument = graphql(`
  query ReportOutcomeArticle($id: String!) {
    GetArticle(id: $id) {
      id
      text
      articleType
      createdAt
      replyCount
      replyRequestCount
      attachmentUrl(variant: PREVIEW)
      articleReplies(statuses: [NORMAL]) {
        createdAt
        positiveFeedbackCount
        negativeFeedbackCount
        user {
          name
        }
        reply {
          id
          type
          text
          reference
          createdAt
          user {
            name
          }
        }
      }
    }
  }
`)

const RequestFactCheckDocument = graphql(`
  mutation RequestFactCheck($articleId: String!, $reason: String) {
    CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {
      id
      replyRequestCount
    }
  }
`)

const CreateArticleReportDocument = graphql(`
  mutation CreateArticleReport(
    $text: String!
    $reference: ArticleReferenceInput!
    $reason: String
  ) {
    CreateArticle(text: $text, reference: $reference, reason: $reason) {
      id
    }
  }
`)

export type SearchCandidate = NonNullable<
  NonNullable<SearchSuspiciousMessagesQuery['ListArticles']>['edges']
>[number]

export type ReportOutcomeArticle = NonNullable<
  ReportOutcomeArticleQuery['GetArticle']
>

export interface SearchResult {
  totalCount: number
  candidates: Array<SearchCandidate>
}

/** How many candidates a person can actually read before giving up. */
const CANDIDATE_LIMIT = 5

/**
 * How much of a bare pasted link has to match, when the submission is nothing
 * but a link.
 *
 * rumors-api's default (`10<70%`) is tuned for prose and is actively wrong here.
 * A URL tokenises into `https`, `www`, `facebook`, `com`, `share` and one
 * unique id, and every Facebook link shares all but the last of those — so on
 * dev, searching for a share link nobody has reported returns 54 unrelated
 * Facebook posts, all scoring an identical 225.5. A candidate list of
 * confident-looking noise is worse than an empty one: it invites the reporter
 * to +1 somebody else's message.
 *
 * At 90% the unique id has to match too, which turns the query into the
 * question actually being asked — "has anyone posted this same link?" — and it
 * answers correctly in both directions: 1 hit for a link that is in the
 * database, 0 for one that is not. 80% is already back in the noise (50 hits).
 *
 * Prose is searched with the default, which is what it was tuned for.
 */
const BARE_LINK_MIN_SHOULD_MATCH = '90%'

export async function findSimilarReports(like: string): Promise<SearchResult> {
  const data = await cofactsExec(SearchSuspiciousMessagesDocument, {
    like,
    first: CANDIDATE_LIMIT,
    minimumShouldMatch: isJustLinks(like) ? BARE_LINK_MIN_SHOULD_MATCH : null,
  })
  const connection = data.ListArticles
  return {
    totalCount: connection?.totalCount ?? 0,
    candidates: connection?.edges ?? [],
  }
}

export interface ReportOutcome {
  article: ReportOutcomeArticle
  articleUrl: string
}

export async function fetchReportOutcome(
  articleId: string,
): Promise<ReportOutcome | null> {
  const data = await cofactsExec(ReportOutcomeArticleDocument, {
    id: articleId,
  })
  if (!data.GetArticle) return null
  return {
    article: data.GetArticle,
    articleUrl: getArticleUrl(data.GetArticle.id),
  }
}

export interface RequestFactCheckInput {
  articleId: string
  /** The reporter's own words. Never a summary written for them. */
  reason?: string
}

export async function recordFactCheckRequest(
  input: RequestFactCheckInput,
): Promise<{ articleId: string; communityDemandCount: number }> {
  await resolveAdkUserIdOrThrow()
  const result = await cofactsExec(RequestFactCheckDocument, {
    articleId: input.articleId,
    reason: input.reason?.trim() || null,
  })
  const article = result.CreateOrUpdateReplyRequest
  if (!article) throw new Error('Article not found')
  return {
    articleId: article.id,
    communityDemandCount: article.replyRequestCount ?? 0,
  }
}

export interface CreateArticleReportInput {
  /** Filed verbatim: what the reporter pasted, not a cleaned-up version. */
  text: string
  /** A link taken from `text`, so someone else can check the message exists. */
  permalink: string
  reason?: string
}

export async function fileArticleReport(
  input: CreateArticleReportInput,
): Promise<{ articleId: string; articleUrl: string }> {
  await resolveAdkUserIdOrThrow()
  const result = await cofactsExec(CreateArticleReportDocument, {
    text: input.text,
    // Always URL. This entry point only accepts messages that arrive with a
    // link, so every report it files can be described honestly — it never hits
    // the missing enum value that forces other non-LINE sources to be
    // labelled LINE.
    reference: { type: 'URL', permalink: input.permalink },
    reason: input.reason?.trim() || null,
  })
  const articleId = result.CreateArticle?.id
  if (!articleId) throw new Error('Cofacts did not return an article id')
  return { articleId, articleUrl: getArticleUrl(articleId) }
}
