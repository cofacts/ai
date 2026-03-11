import { z } from 'zod';

export const SearchCofactsDatabaseSchema = z.object({
  query: z.string().optional().describe('The suspicious message or claim to search for (for similarity search)'),
  article_ids: z.array(z.string()).optional().describe('List of specific article IDs to retrieve (alternative to query)'),
  limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
  after: z.string().optional().describe('Cursor for pagination - returns results after this cursor'),
  reply_count_max: z.number().optional().describe('Maximum number of replies (useful for finding articles that need more fact-checks)'),
  days_back: z.number().optional().describe('Only include articles created within this many days (useful for trending articles)'),
  order_by: z.enum(['_score', 'replyRequestCount', 'createdAt']).optional().default('_score').describe('Sort order - "_score" (relevance), "replyRequestCount" (demand for fact-checks), "createdAt"')
});

export const GetSingleCofactsArticleSchema = z.object({
  article_id: z.string().describe('The Cofacts article ID to retrieve')
});
