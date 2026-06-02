"""
Fact-checking tools for Cofacts AI agents to verify suspicious messages and claims.

Articles in Cofacts represent suspicious messages reported by users through LINE.
Each Article may have multiple ArticleReplies (fact-check responses from collaborators)
and ReplyRequests (additional context provided by reporters or collaborators).
"""

import asyncio
import json
import os
from typing import Any, Dict, List, Optional

import httpx

# GraphQL fragment for common Article fields
COMMON_ARTICLE_FIELDS = """
  fragment CommonArticleFields on Article {
    id
    text
    createdAt
    articleType
    attachmentUrl(variant: PREVIEW)
    factCheckCount: replyCount
    communityDemandCount: replyRequestCount
    hyperlinks {
      url
      title
      summary
      status
      error
    }
    factCheckResponses: articleReplies(statuses: [NORMAL]) {
      reply {
        id
        type
        text
        createdAt
        reference
        user {
          name
        }
        hyperlinks {
          url
          normalizedUrl
          title
          summary
          topImageUrl
          status
          error
        }
      }
      user {
        name
      }
      createdAt
      helpfulCount: positiveFeedbackCount
      unhelpfulCount: negativeFeedbackCount
      feedbacks(statuses: [NORMAL]) {
        vote
        comment
        createdAt
        user {
          name
        }
      }
    }
    additionalContext: replyRequests(statuses: [NORMAL]) {
      user {
        name
      }
      reason
      createdAt
      helpfulCount: positiveFeedbackCount
      unhelpfulCount: negativeFeedbackCount
    }
    bundledMessages: cooccurrences {
      id
      articleIds
      createdAt
      articles {
        id
        text
        articleType
        attachmentUrl(variant: PREVIEW)
      }
    }
    relatedArticles(first: 10) {
      totalCount
      edges {
        node {
          id
          text
          articleType
          factCheckCount: replyCount
          createdAt
          factCheckResponses: articleReplies(statuses: [NORMAL]) {
            reply {
              id
              type
              text
            }
            helpfulCount: positiveFeedbackCount
            unhelpfulCount: negativeFeedbackCount
          }
        }
        score
      }
    }
    stats(dateRange: { GTE: "now-90d/d" }) {
      date
      lineUser
      lineVisit
      webUser
      webVisit
      downstreamBotUsers: liffUser
      downstreamBotVisits: liffVisit
    }
  }
"""


async def _execute_cofacts_graphql(
    query: str, variables: Dict[str, Any], operation_name: str = "GraphQL request"
) -> Dict[str, Any]:
    """
    Execute a GraphQL query against Cofacts API with standardized error handling.

    Args:
        query: The GraphQL query string
        variables: Variables for the GraphQL query
        operation_name: Name of the operation for error reporting

    Returns:
        Response containing either data or error information
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            api_base = os.environ.get(
                "COFACTS_API_URL", "https://api.cofacts.tw"
            ).rstrip("/")
            response = await client.post(
                f"{api_base}/graphql",
                json={"query": query, "variables": variables},
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()

            result = response.json()

            if "errors" in result:
                return {
                    "error": f"GraphQL errors: {result['errors']}",
                }

            return {
                "success": True,
                "data": result["data"],
            }

    except Exception as e:
        return {
            "error": f"Failed to execute {operation_name}: {str(e)}",
        }


async def search_cofacts_database(
    query: Optional[str] = None,
    article_ids: Optional[List[str]] = None,
    limit: int = 10,
    after: Optional[str] = None,
    reply_count_max: Optional[int] = None,
    days_back: Optional[int] = None,
    order_by: str = "_score",
) -> Dict[str, Any]:
    """
    Search the Cofacts database for articles using various filters.

    This unified function can:
    - Search by text similarity (query parameter)
    - Get specific articles by IDs (article_ids parameter)
    - Find trending articles needing fact-checks (reply_count_max + days_back)
    - Apply various filters and sorting options

    Cofacts Articles represent suspicious messages reported by LINE users. Key information includes:
    - articleType: Whether the message is TEXT, IMAGE, VIDEO, or AUDIO
    - text: For text messages, this is the content. For media, this is OCR/transcript result
    - attachmentUrl: Preview of media content (when articleType is not TEXT)
    - factCheckResponses: Fact-check responses from collaborators with community feedback scores (helpfulCount/unhelpfulCount)
    - additionalContext: Additional context from reporters with community ratings (helpfulCount/unhelpfulCount)
    - communityDemandCount: Number of people who wanted to know the truth before fact-checks were available
    - hyperlinks: URLs found in the message with crawled metadata
    - bundledMessages: Messages reported together, indicating they were shared as a set
    - relatedArticles: Similar messages that may have existing fact-checks
    - stats: Actual traffic/popularity data (views, visits) - use this for current hotness metrics

    Args:
        query: The suspicious message or claim to search for (for similarity search)
        article_ids: List of specific article IDs to retrieve (alternative to query)
        limit: Maximum number of results to return (default: 10)
        after: Cursor for pagination - returns results after this cursor
        reply_count_max: Maximum number of replies (useful for finding articles that need more fact-checks)
        days_back: Only include articles created within this many days (useful for trending articles)
        order_by: Sort order - "_score" (relevance), "replyRequestCount" (demand for fact-checks), "createdAt"

    Note about metrics:
    - communityDemandCount: Reflects community demand - how many people wanted to know the truth before fact-checks were available
    - stats field: Provides actual traffic/popularity data across different platforms:
      * LINE chatbot stats (lineUser/lineVisit) show direct user engagement
      * Website stats (webUser/webVisit) show web-based traffic
      * Downstream bot stats (downstreamBotUsers/downstreamBotVisits) indicate usage by third-party fact-checking services

    Returns:
        Search results from Cofacts database with pagination info
    """
    try:
        # Build filter object based on parameters
        filter_obj = {}

        if query:
            filter_obj["moreLikeThis"] = {"like": query, "minimumShouldMatch": "0"}

        if article_ids:
            filter_obj["ids"] = article_ids

        if reply_count_max is not None:
            filter_obj["replyCount"] = {"LT": reply_count_max}

        if days_back is not None:
            from datetime import datetime, timedelta

            end_date = datetime.now()
            start_date = end_date - timedelta(days=days_back)
            filter_obj["createdAt"] = {
                "GTE": start_date.isoformat(),
                "LTE": end_date.isoformat(),
            }

        # Build orderBy based on order_by parameter
        if order_by == "replyRequestCount":
            order_by_obj = [{"replyRequestCount": "DESC"}, {"createdAt": "DESC"}]
        elif order_by == "createdAt":
            order_by_obj = [{"createdAt": "DESC"}]
        else:  # default to _score
            order_by_obj = [{"_score": "DESC"}]

        graphql_query = f"""
        {COMMON_ARTICLE_FIELDS}

        query ListArticles($filter: ListArticleFilter!, $orderBy: [ListArticleOrderBy!]!, $first: Int!, $after: String) {{
          ListArticles(
            filter: $filter
            orderBy: $orderBy
            first: $first
            after: $after
          ) {{
            totalCount
            pageInfo {{
              firstCursor
              lastCursor
            }}
            edges {{
              node {{
                ...CommonArticleFields
              }}
              score
              cursor
            }}
          }}
        }}
        """

        variables = {
            "filter": filter_obj,
            "orderBy": order_by_obj,
            "first": limit,
            "after": after,
        }

        result = await _execute_cofacts_graphql(
            query=graphql_query,
            variables=variables,
            operation_name="search Cofacts database",
        )

        if "error" in result:
            return result

        # Extract ListArticles data from the successful response
        return {"data": result["data"]["ListArticles"]}

    except Exception as e:
        return {
            "error": f"Failed to search Cofacts database: {str(e)}",
        }


async def get_single_cofacts_article(article_id: str) -> Dict[str, Any]:
    """
    Get a single article from Cofacts database by ID.

    Returns the same detailed article information as search_cofacts_database, but for a single specific article.
    For detailed field descriptions, see search_cofacts_database function documentation.

    The article ID can be used to construct Cofacts URLs: https://cofacts.tw/article/{article_id}

    Args:
        article_id: The Cofacts article ID to retrieve

    Returns:
        Detailed article information from Cofacts (same structure as search_cofacts_database results)
    """
    try:
        graphql_query = f"""
        {COMMON_ARTICLE_FIELDS}

        query GetArticle($id: String!) {{
          GetArticle(id: $id) {{
            ...CommonArticleFields
          }}
        }}
        """

        variables = {"id": article_id}

        result = await _execute_cofacts_graphql(
            query=graphql_query,
            variables=variables,
            operation_name="get specific Cofacts article",
        )

        if "error" in result:
            return result

        article = result["data"]["GetArticle"]
        if not article:
            return {
                "error": f"Article not found",
                "article_id": article_id,
            }

        return {
            "article_id": article_id,
            "article": article,
        }

    except Exception as e:
        return {
            "error": f"Failed to get Cofacts article: {str(e)}",
            "article_id": article_id,
        }


async def submit_cofacts_reply(
    article_id: str, reply_type: str, text: str, reference: str
) -> Dict[str, Any]:
    """
    Submit a fact-check reply to Cofacts (requires authentication).

    Note: This requires authentication with Cofacts API which is not yet implemented.
    Currently returns a placeholder response.

    Args:
        article_id: The Cofacts article ID to reply to
        reply_type: Type of reply ("RUMOR", "NOT_RUMOR", "OPINIONATED", "NOT_ARTICLE")
        text: The fact-check response text
        reference: URLs and summaries as references

    Returns:
        Result of the submission
    """
    try:
        # Note: This requires authentication with Cofacts API
        # You'll need to implement proper OAuth or API key authentication

        graphql_mutation = """
        mutation CreateReply($text: String!, $type: ReplyTypeEnum!, $reference: String!) {
          CreateReply(text: $text, type: $type, reference: $reference) {
            id
            text
            type
            reference
            createdAt
          }
        }
        """

        variables = {"text": text, "type": reply_type, "reference": reference}

        # This is a placeholder - you'll need to implement proper authentication
        return {
            "message": "Reply submission requires authentication setup",
            "article_id": article_id,
            "reply_type": reply_type,
            "text_length": len(text),
            "reference_length": len(reference),
        }

    except Exception as e:
        return {
            "error": f"Failed to submit Cofacts reply: {str(e)}",
            "article_id": article_id,
        }


def draft_factcheck_response(
    classification: str,
    text: str,
    references: str,
    claim_sources: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Draft a Cofacts fact-check response for human editor review.

    Call this tool once you have completed all research and review steps and are
    ready to propose a reply. Before calling, share your analysis and reasoning
    in text — explain your classification choice and the key points of the reply.
    Then call this tool as the concluding action.

    Args:
        classification: One of:
            - "RUMOR" (含有不實訊息): The message contains misinformation.
            - "NOT_RUMOR" (含有正確訊息): The message contains true information.
            - "OPINIONATED" (含有個人意見): The message contains personal perspective.
            - "NOT_ARTICLE" (不在查證範圍): The message is not within the scope of fact-checking.
        text: The fact-check response body. Rules:
            - Plain text only — no Markdown, no URLs, no reference citations.
            - Emojis at the start of paragraphs are encouraged for readability.
            - Neutral, educational tone aimed at people who shared or received the message.
            - Include only claims confirmed by the verifier step.
        references: Source references for the reply. Format: one source per line,
            each line is a URL followed by a one-line summary of what that source says.
            Only include URLs returned by investigator or verifier — never invent URLs.
        claim_sources: Per-claim source coverage — REQUIRED unless classification is
            "NOT_ARTICLE". One entry per distinct factual claim/number in `text`, each:
            {
              "claim": "<the factual claim or number as stated in text>",
              "source_url": "<the URL that backs it — must also appear in references>",
              "verifier_confirmed": true  // true ONLY if the verifier step returned ✓
                                          // for this claim against this exact URL
            }
            This forces you to show which source backs which fact. The call is rejected
            if any claim is not verifier_confirmed, or if a source_url is missing from
            references — drop or re-verify such claims before drafting (do not relabel
            a different URL for a claim the verifier marked ✗).

    Returns:
        {"success": True, "text": "..."} on success, or
        {"success": False, "text": "<error message>"} asking the AI to fix and retry.
    """
    import re

    VALID_CLASSIFICATIONS = {"RUMOR", "NOT_RUMOR", "OPINIONATED", "NOT_ARTICLE"}
    if classification not in VALID_CLASSIFICATIONS:
        return {
            "success": False,
            "text": (
                f'Invalid classification "{classification}". '
                f"Must be one of: {', '.join(sorted(VALID_CLASSIFICATIONS))}. "
                "Please call draft_factcheck_response again with a valid classification."
            ),
        }

    if not re.search(r"https?://", references):
        return {
            "success": False,
            "text": (
                "references must contain at least one https:// URL. "
                "Please provide source URLs from the investigator or verifier results, "
                "then call draft_factcheck_response again."
            ),
        }

    # Per-claim source coverage gate. NOT_ARTICLE (out of scope) is exempt; every
    # other classification — including OPINIONATED, which still cites real facts —
    # must map each factual claim to a verifier-confirmed URL that is in references.
    if classification != "NOT_ARTICLE":
        if not claim_sources:
            return {
                "success": False,
                "text": (
                    "claim_sources is required for this classification. Provide one entry "
                    "per factual claim/number in your reply, each "
                    '{"claim": "...", "source_url": "...", "verifier_confirmed": true}, '
                    "where verifier_confirmed is true only for claims the verifier marked ✓. "
                    "Run the verifier step first if you have not, then call "
                    "draft_factcheck_response again."
                ),
            }

        # The leading token of each non-empty references line is the URL
        # ("URL one-line-summary"); match against that set rather than a
        # substring of the whole string (a short URL can be a substring of a
        # longer listed one).
        reference_urls = {
            line.split(None, 1)[0]
            for line in (ln.strip() for ln in references.splitlines())
            if line
        }

        malformed = []
        unconfirmed = []
        not_in_references = []
        for entry in claim_sources:
            if not isinstance(entry, dict):
                malformed.append(str(entry))
                continue
            claim = str(entry.get("claim") or "").strip()
            url = str(entry.get("source_url") or "").strip()
            if not claim or not url:
                malformed.append(json.dumps(entry, ensure_ascii=False))
                continue
            if entry.get("verifier_confirmed") is not True:
                unconfirmed.append(claim)
            if url not in reference_urls:
                not_in_references.append(url)

        if malformed:
            return {
                "success": False,
                "text": (
                    "Each claim_sources entry must be an object with non-empty 'claim' and "
                    "'source_url'. Fix these entries and call draft_factcheck_response again: "
                    + "; ".join(malformed)
                ),
            }
        if unconfirmed:
            return {
                "success": False,
                "text": (
                    "These claims are not verifier-confirmed, so they cannot appear in the "
                    "reply. Drop each one, OR verify it against a source with the verifier "
                    "and set verifier_confirmed=true, then call draft_factcheck_response "
                    "again: " + "; ".join(unconfirmed)
                ),
            }
        if not_in_references:
            return {
                "success": False,
                "text": (
                    "These source_url values are not present in references. Add each source "
                    "(URL + one-line summary) to references so the citation is visible, then "
                    "call draft_factcheck_response again: " + "; ".join(not_in_references)
                ),
            }

    return {
        "success": True,
        "text": (
            "The draft is now displayed to the user as a tool call result in this conversation. "
            "Guide the user to open the tool call result above to read the draft, "
            "then ask if they have any feedback or edits before submitting to Cofacts."
        ),
    }


async def resolve_vertex_redirect(url: str) -> str:
    """
    Resolve a vertexaisearch redirect URL to its final destination.
    If the URL is not a vertexaisearch redirect URL or if resolution fails,
    returns the original URL.

    Args:
        url: The URL to resolve.

    Returns:
        The resolved URL, or the original URL if resolution fails or is not applicable.
    """
    if "vertexaisearch.cloud.google.com/grounding-api-redirect/" not in url:
        return url

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # We use HEAD request to follow redirects without downloading the full content
            response = await client.head(url)
            return str(response.url)
    except Exception as e:
        # If resolution fails, fall back to the original URL
        print(f"Failed to resolve redirect for {url}: {e}")
        return url
