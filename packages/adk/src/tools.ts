import { FunctionTool } from '@google/adk';
import { GraphQLClient, gql } from 'graphql-request';
import { z } from 'zod';
import { SearchCofactsDatabaseSchema, GetSingleCofactsArticleSchema } from '@cofacts-ai/shared/schemas';

const COFACTS_API_URL = 'https://cofacts-api.g0v.tw/graphql';

const COMMON_ARTICLE_FIELDS = gql`
  fragment CommonArticleFields on Article {
    id
    articleType
    text
    attachmentUrl
    replyRequestCount
    createdAt
    factCheckResponses: articleReplies(status: NORMAL) {
      reply {
        id
        type
        text
        reference
        createdAt
      }
      positiveFeedbackCount
      negativeFeedbackCount
    }
  }
`;

const client = new GraphQLClient(COFACTS_API_URL);

async function searchCofactsDatabaseFn(args: z.infer<typeof SearchCofactsDatabaseSchema>) {
  try {
    const filterObj: any = {};
    if (args.query) {
      filterObj.moreLikeThis = { like: args.query, minimumShouldMatch: '0' };
    }
    if (args.article_ids) {
      filterObj.ids = args.article_ids;
    }
    if (args.reply_count_max !== undefined) {
      filterObj.replyCount = { LT: args.reply_count_max };
    }
    if (args.days_back !== undefined) {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - args.days_back);
      filterObj.createdAt = {
        GTE: startDate.toISOString(),
        LTE: endDate.toISOString()
      };
    }

    let orderByObj: any[] = [{ _score: 'DESC' }];
    if (args.order_by === 'replyRequestCount') {
      orderByObj = [{ replyRequestCount: 'DESC' }, { createdAt: 'DESC' }];
    } else if (args.order_by === 'createdAt') {
      orderByObj = [{ createdAt: 'DESC' }];
    }

    const query = gql`
      ${COMMON_ARTICLE_FIELDS}
      query ListArticles($filter: ListArticleFilter!, $orderBy: [ListArticleOrderBy!]!, $first: Int!, $after: String) {
        ListArticles(filter: $filter, orderBy: $orderBy, first: $first, after: $after) {
          totalCount
          pageInfo {
            firstCursor
            lastCursor
          }
          edges {
            node {
              ...CommonArticleFields
            }
            score
            cursor
          }
        }
      }
    `;

    const variables = {
      filter: filterObj,
      orderBy: orderByObj,
      first: args.limit || 10,
      after: args.after
    };

    const data: any = await client.request(query, variables);
    return { data: data.ListArticles };
  } catch (error: any) {
    return { error: `Failed to search Cofacts database: ${error.message}` };
  }
}

export const search_cofacts_database = new FunctionTool({
  name: 'search_cofacts_database',
  description: 'Search the Cofacts database for articles using various filters.',
  parameters: SearchCofactsDatabaseSchema as any,
  run: searchCofactsDatabaseFn
} as any);

async function getSingleCofactsArticleFn(args: z.infer<typeof GetSingleCofactsArticleSchema>) {
  try {
    const query = gql`
      ${COMMON_ARTICLE_FIELDS}
      query GetArticle($id: String!) {
        GetArticle(id: $id) {
          ...CommonArticleFields
        }
      }
    `;

    const variables = { id: args.article_id };
    const data: any = await client.request(query, variables);

    if (!data.GetArticle) {
      return { error: 'Article not found', article_id: args.article_id };
    }

    return { article_id: args.article_id, article: data.GetArticle };
  } catch (error: any) {
    return { error: `Failed to get Cofacts article: ${error.message}` };
  }
}

export const get_single_cofacts_article = new FunctionTool({
  name: 'get_single_cofacts_article',
  description: 'Get a single article from Cofacts database by ID.',
  parameters: GetSingleCofactsArticleSchema as any,
  run: getSingleCofactsArticleFn
} as any);
