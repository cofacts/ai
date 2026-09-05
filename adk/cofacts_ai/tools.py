"""
Fact-checking tools for Cofacts AI agents to verify suspicious messages and claims.

Articles in Cofacts represent suspicious messages reported by users through LINE.
Each Article may have multiple ArticleReplies (fact-check responses from collaborators)
and ReplyRequests (additional context provided by reporters or collaborators).
"""

import json
import os
from typing import Any, Dict, List, Optional

import httpx
from google.cloud import vision
from .auth_context import cofacts_token_var
from .cofacts_site import article_url
from .media_filedata import signed_url_to_gs

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
    query: str,
    variables: Dict[str, Any],
    operation_name: str = "GraphQL request",
    auth_token: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute a GraphQL query against Cofacts API with standardized error handling.

    Args:
        query: The GraphQL query string
        variables: Variables for the GraphQL query
        operation_name: Name of the operation for error reporting
        auth_token: Optional JWT token issued by rumors-api for authenticated requests

    Returns:
        Response containing either data or error information
    """
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if auth_token:
        headers["x-app-id"] = "RUMORS_SITE"
        headers["Authorization"] = f"Bearer {auth_token}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Defaults to staging to match cofacts_site.py: if these two ever
            # disagree, we file an article into one Cofacts and hand the user a
            # link into the other. The frontend refuses to start without this
            # var (src/server/api-base.ts); here a wrong default would be a
            # silent write to the wrong database.
            api_base = os.environ.get(
                "COFACTS_API_URL", "https://dev-api.cofacts.tw"
            ).rstrip("/")
            response = await client.post(
                f"{api_base}/graphql",
                json={"query": query, "variables": variables},
                headers=headers,
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
            auth_token=cofacts_token_var.get(),
        )

        if "error" in result:
            return result

        list_articles = result["data"]["ListArticles"]
        for edge in list_articles.get("edges") or []:
            article = edge.get("node") or {}
            url = article.get("attachmentUrl")
            if url:
                article["attachmentUrl"] = signed_url_to_gs(url) or url

        return {"data": list_articles}

    except Exception as e:
        return {
            "error": f"Failed to search Cofacts database: {str(e)}",
        }


async def get_single_cofacts_article(
    article_id: str,
) -> Dict[str, Any]:
    """
    Get a single article from Cofacts database by ID.

    Returns the same detailed article information as search_cofacts_database, but for a single specific article.
    For detailed field descriptions, see search_cofacts_database function documentation.

    The result's `article_url` is the page a human can open to read this
    message on Cofacts — link to that rather than building a URL yourself.

    The result carries a `cite_as` id — cite it to let a sub-agent read the suspicious
    message in full instead of retyping or paraphrasing it.

    Args:
        article_id: The Cofacts article ID to retrieve

    Returns:
        Detailed article information from Cofacts (same structure as
        search_cofacts_database results), plus `article_url` for linking.
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
            auth_token=cofacts_token_var.get(),
        )

        if "error" in result:
            return result

        article = result["data"]["GetArticle"]
        if not article:
            return {
                "error": "Article not found",
                "article_id": article_id,
            }

        # Rewrite the signed HTTPS attachmentUrl to a non-expiring, Vertex-native
        # gs:// URI here, in the tool we control, so every consumer (the writer
        # and anything it forwards to the verifier) only ever sees the gs:// form.
        # signed_url_to_gs returns None for a value that is not a GCS HTTPS URL
        # (e.g. already gs://), in which case we keep the original unchanged.
        attachment_url = article.get("attachmentUrl")
        if attachment_url:
            article["attachmentUrl"] = (
                signed_url_to_gs(attachment_url) or attachment_url
            )

        return {
            "article_id": article_id,
            "article_url": article_url(article_id),
            "article": article,
        }

    except Exception as e:
        return {
            "error": f"Failed to get Cofacts article: {str(e)}",
            "article_id": article_id,
        }


# Trimmed text length for search results. The receptionist only needs enough
# for the user to recognise which message is theirs; the full text arrives with
# get_single_cofacts_article once they pick one.
_SEARCH_RESULT_TEXT_LIMIT = 150


async def search_suspicious_messages(
    query: str,
    limit: int = 5,
) -> Dict[str, Any]:
    """
    Search Cofacts for suspicious messages similar to what the user pasted.

    Use this to find out whether a message has already been reported, so the
    user can pick the one they mean instead of reporting a duplicate. Present
    the results as a short numbered list and let the user choose; then call
    get_single_cofacts_article for the one they picked.

    Deliberately returns far less per article than search_cofacts_database: no
    existing fact-check replies, no popularity stats, no related articles. Two
    reasons. Choosing from a list only needs enough text to recognise the
    message, and — because everything this agent does is replayed to the writer
    as flattened plain text once control transfers — a full article payload per
    hit would be pasted into the writer's context verbatim.

    Args:
        query: The suspicious message text, or the URL the user pasted.
        limit: How many candidates to return (default 5).

    Returns:
        {"data": {"totalCount": int, "results": [
            {id, text, articleType, createdAt, factCheckCount, communityDemandCount}
        ]}} — `factCheckCount` of 0 means nobody has fact-checked it yet, which
        is the branch where you offer request_fact_check. Or {"error": ...}.
    """
    try:
        graphql_query = """
        query SearchSuspiciousMessages($filter: ListArticleFilter!, $first: Int!) {
          ListArticles(
            filter: $filter
            orderBy: [{ _score: DESC }]
            first: $first
          ) {
            totalCount
            edges {
              node {
                id
                text
                articleType
                createdAt
                factCheckCount: replyCount
                communityDemandCount: replyRequestCount
              }
            }
          }
        }
        """

        result = await _execute_cofacts_graphql(
            query=graphql_query,
            variables={
                "filter": {"moreLikeThis": {"like": query, "minimumShouldMatch": "0"}},
                "first": limit,
            },
            operation_name="search suspicious messages",
            auth_token=cofacts_token_var.get(),
        )

        if "error" in result:
            return result

        list_articles = result["data"]["ListArticles"]
        results = []
        for edge in list_articles.get("edges") or []:
            node = dict(edge.get("node") or {})
            text = node.get("text") or ""
            if len(text) > _SEARCH_RESULT_TEXT_LIMIT:
                node["text"] = text[:_SEARCH_RESULT_TEXT_LIMIT] + "..."
            results.append(node)

        return {
            "data": {
                "totalCount": list_articles.get("totalCount", 0),
                "results": results,
            }
        }

    except Exception as e:
        return {
            "error": f"Failed to search suspicious messages: {str(e)}",
        }


async def request_fact_check(
    article_id: str,
    reason: str,
) -> Dict[str, Any]:
    """
    Add the user's +1 to an existing Cofacts message that has no fact-check yet.

    This is how cofacts.ai feeds Cofacts' main popularity signal
    (`replyRequestCount`): it records that one more real person wants this
    message checked, and `reason` tells the volunteer who eventually picks it up
    why the user found it suspicious — a field that is almost always empty for
    LINE-bot reports, so it is worth actually asking for.

    Call this only after the user has picked a specific message from
    search_suspicious_messages AND that message has no fact-check response yet
    (factCheckCount == 0). For a message that already has responses, walk the
    user through the existing answer instead — do not call this.

    Ask the user "why did this look suspicious to you?" and pass their own words
    as `reason`. Do not invent one, and do not put personally identifying
    information (names, phone numbers, addresses, order numbers) in it.

    This is create-or-*update*, scoped to the logged-in user: the same person
    +1-ing the same message twice updates their existing request rather than
    inflating the count, so a repeat call is safe but pointless.

    Args:
        article_id: The Cofacts article ID the user picked.
        reason: Why the user thinks the message is suspicious, in their words.

    Returns:
        {"success": True, "article_id": ..., "communityDemandCount": int} — the
        count already includes this request. Or {"error": ...}.
    """
    auth_token = cofacts_token_var.get()
    if not auth_token:
        return {
            "error": "not_authenticated",
            "message": (
                "[SYSTEM] Cannot record a fact-check request without a signed-in "
                "user. Ask the user to sign in and try again."
            ),
        }

    try:
        graphql_query = """
        mutation RequestFactCheck($articleId: String!, $reason: String) {
          CreateOrUpdateReplyRequest(articleId: $articleId, reason: $reason) {
            id
            replyRequestCount
          }
        }
        """

        result = await _execute_cofacts_graphql(
            query=graphql_query,
            variables={"articleId": article_id, "reason": reason},
            operation_name="request fact-check",
            auth_token=auth_token,
        )

        if "error" in result:
            return result

        article = result["data"]["CreateOrUpdateReplyRequest"]
        if not article:
            return {
                "error": "Article not found",
                "article_id": article_id,
            }

        return {
            "success": True,
            "article_id": article.get("id", article_id),
            "communityDemandCount": article.get("replyRequestCount"),
        }

    except Exception as e:
        return {
            "error": f"Failed to request fact-check: {str(e)}",
            "article_id": article_id,
        }


async def submit_suspicious_message(
    text: str,
    reason: str,
    source_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    File a suspicious message that is NOT yet in Cofacts into the database.

    This is the only tool that creates something in Cofacts. Call it after
    search_suspicious_messages found nothing the user recognises AND the user
    has said yes to filing it. Never call it speculatively: the article becomes
    a public page under the user's own account the moment this returns.

    `text` MUST be the user's message verbatim — what they received, exactly as
    they pasted it. Do not summarise it, translate it, tidy it up, or merge in
    your own words. Cofacts matches reports against each other by their text, so
    a rewritten report is a report that will never be recognised as the same
    rumour again. If the user pasted a link, the link itself is the text:
    rumors-api crawls it and fills in the title and summary on its own.

    Filing the same text twice returns the same article, so a message the
    database already holds cannot be duplicated by this tool.

    Args:
        text: The suspicious message, in the user's own words, verbatim.
        reason: Why the user finds it suspicious, in their words. Goes to the
            volunteer who eventually fact-checks it, and is almost always empty
            on LINE-bot reports — so it is worth having asked. Do not invent
            one, and keep personally identifying information out of it.
        source_url: Where the message is circulating, if the user gave a link
            (a Threads / Facebook / X post, a news page). Recorded as the
            article's reference so we can tell which platforms rumours spread
            on. Leave it out for text the user copied out of a chat app.

    Returns:
        {"success": True, "article_id": ..., "article_url": ...} — show the URL
        to the user, it is the page they can now share. Or {"error": ...}.
    """
    auth_token = cofacts_token_var.get()
    if not auth_token:
        return {
            "error": "not_authenticated",
            "message": (
                "[SYSTEM] Cannot file a message into the database without a "
                "signed-in user. Ask the user to sign in and try again."
            ),
        }

    try:
        graphql_query = """
        mutation SubmitSuspiciousMessage(
          $text: String!
          $reference: ArticleReferenceInput!
          $reason: String
        ) {
          CreateArticle(text: $text, reference: $reference, reason: $reason) {
            id
          }
        }
        """

        # ArticleReferenceTypeEnum only has URL and LINE, so a message copied
        # out of any other app (IG, Discord, SMS, WhatsApp) can only be marked
        # LINE. That is a known gap in rumors-api, tracked in the design doc's
        # "reference type" section, and it means this field slightly overstates
        # how much of Cofacts came from LINE.
        reference: Dict[str, Any] = (
            {"type": "URL", "permalink": source_url} if source_url else {"type": "LINE"}
        )

        result = await _execute_cofacts_graphql(
            query=graphql_query,
            variables={"text": text, "reference": reference, "reason": reason},
            operation_name="submit suspicious message",
            auth_token=auth_token,
        )

        if "error" in result:
            return result

        article = result["data"]["CreateArticle"]
        if not article or not article.get("id"):
            return {"error": "Cofacts accepted the request but returned no article"}

        article_id = article["id"]
        return {
            "success": True,
            "article_id": article_id,
            "article_url": article_url(article_id),
        }

    except Exception as e:
        return {
            "error": f"Failed to submit suspicious message: {str(e)}",
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
        # via the CreateReply GraphQL mutation.

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


# The language rule is restated in `text`'s own rules rather than left to
# language.py alone: this body is, by the description below, aimed at whoever
# encounters the message on Cofacts rather than at the person in the chat, so a
# rule about what to write "to the user" reads as out of scope — and the
# fallback is Chinese, which is what Cofacts means to a model. On this demo
# branch the reviewer and the eventual reader are the same person in the room.
# If replies ever actually get submitted to Cofacts, whose language this should
# be is a real question again, and the answer may not be English.
def draft_factcheck_response(
    classification: str,
    text: str,
    references: str,
    claim_sources: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Submit a fact-check response proposal for human editor review.

    This tool is re-callable: submit a proposal, read the validation feedback below
    (or feedback from proofreader review), revise, and call it again — as many times
    as needed. Every call returns its own `cite_as` id, so any proposal — including
    one this tool rejected — can be quoted verbatim to a proofreader later. Always
    call it alone, never in the same turn as any other tool, so a proposal is
    reliably in place before you cite it.

    Before calling, share your analysis and reasoning in text — explain your
    classification choice and the key points of the reply. Call this tool once you
    have completed all research and verification steps and are ready to propose a
    reply; end on a submission that passes validation.

    Args:
        classification: One of:
            - "RUMOR": The message contains misinformation.
            - "NOT_RUMOR": The message contains true information.
            - "OPINIONATED": The message contains personal perspective.
            - "NOT_ARTICLE": The message is not within the scope of fact-checking.
        text: The fact-check response body. Rules:
            - Write it in English, like everything else on this deployment.
              The user is being asked to review this draft, and a reply they
              cannot read is not a reply they can review. Do NOT switch to
              Chinese because Cofacts is a Taiwanese database or because the
              message you are checking is in Chinese.
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
                    "call draft_factcheck_response again: "
                    + "; ".join(not_in_references)
                ),
            }

    return {
        "success": True,
        "text": (
            "Proposal accepted. To have a proofreader review it, cite this result's `cite_as` id in "
            "the proofreader's request. If proofreader review or your own judgment still calls for "
            "changes, revise and call this tool again — only your LAST successful call is shown to "
            "the user once you finish responding. If this is your final proposal, guide the user to "
            "open the tool call result above to read the draft, then ask if they have any feedback "
            "or edits before submitting to Cofacts."
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


_vision_client: Optional[vision.ImageAnnotatorAsyncClient] = None


def _get_vision_client() -> vision.ImageAnnotatorAsyncClient:
    """Reused Vision client, authenticated via Application Default Credentials.

    ADC is the same auth the rest of the codebase uses for Google APIs: a service
    account in the deployed environment, and `gcloud auth application-default login`
    for local development. No separate API key is minted. The client is created once
    and reused so a steady stream of image searches shares one authenticated channel.
    """
    global _vision_client
    if _vision_client is None:
        _vision_client = vision.ImageAnnotatorAsyncClient()
    return _vision_client


async def search_image_web(image_url: str) -> Dict[str, Any]:
    """
    Reverse image search via Google Vision API WEB_DETECTION.

    Surfaces what an image shows and where it already appears on the web so a
    fact-check can spot a repurposed, out-of-context, or AI-generated photo.

    Args:
        image_url: gs:// URI of the image. search_cofacts_database and
            get_single_cofacts_article already return article attachmentUrl as a
            gs:// URI, so forward that value as-is.

    Returns:
        Compact, structured WEB_DETECTION results for the writer:
        - bestGuessLabels: what the image most likely shows;
        - webEntities: named entities detected in the image, with confidence;
        - pagesWithMatchingImages: web pages where the image appears (the strongest
          out-of-context / miscaption signal, and a handoff for investigator/verifier).
        The raw match-image URL lists (full/partial/visually-similar) are omitted on
        purpose: the writer already sees the original image, so they add cost and
        noise without adding provenance. Returns {"error": ...} on any failure.
    """
    try:
        client = _get_vision_client()
        request = vision.AnnotateImageRequest(
            image=vision.Image(source=vision.ImageSource(image_uri=image_url)),
            features=[
                vision.Feature(type_=vision.Feature.Type.WEB_DETECTION, max_results=10)
            ],
        )
        response = await client.batch_annotate_images(requests=[request])

        if not response.responses:
            return {"error": "Vision API returned no response", "image_url": image_url}

        annotation = response.responses[0]
        if annotation.error.message:
            return {
                "error": f"Vision API error: {annotation.error.message}",
                "image_url": image_url,
            }

        web = annotation.web_detection
        return {
            "bestGuessLabels": [
                label.label for label in web.best_guess_labels if label.label
            ],
            "webEntities": [
                {"description": entity.description, "score": round(entity.score, 3)}
                for entity in web.web_entities
                if entity.description
            ][:10],
            "pagesWithMatchingImages": [
                {"url": page.url, "pageTitle": page.page_title}
                for page in web.pages_with_matching_images
            ][:10],
        }

    except Exception as e:
        return {
            "error": f"Failed to search image web: {str(e)}",
            "image_url": image_url,
        }
