"""Unit tests for the receptionist's two intake tools.

`search_suspicious_messages` and `request_fact_check` are the only tools the
front desk has that the writer does not already share, and both are thin
wrappers over `_execute_cofacts_graphql`. So the transport is patched out and
what is tested is what the wrappers themselves decide: which fields survive
into the writer-visible payload, and what happens on the failure paths that
have a user-facing consequence (no signed-in user, a GraphQL error, a message
that no longer exists).

The auth token is a ContextVar rather than an argument, so tests set it
explicitly and reset it; leaving it set would leak a signed-in user into the
next test.
"""

from collections.abc import Mapping
from typing import Any, Optional
from unittest.mock import AsyncMock

import pytest

from cofacts_ai import tools
from cofacts_ai.auth_context import cofacts_token_var
from cofacts_ai.tools import (
    _SEARCH_RESULT_TEXT_LIMIT,
    request_fact_check,
    search_suspicious_messages,
)


@pytest.fixture
def signed_in():
    """A request carrying a rumors-api JWT, as main.py's middleware sets it."""
    token = cofacts_token_var.set("jwt-token")
    yield "jwt-token"
    cofacts_token_var.reset(token)


@pytest.fixture
def signed_out():
    token = cofacts_token_var.set(None)
    yield
    cofacts_token_var.reset(token)


def patch_graphql(monkeypatch, result: Any) -> AsyncMock:
    """Replace the GraphQL transport, returning the mock so the test can assert
    on the variables the tool sent."""
    mock = AsyncMock(return_value=result)
    monkeypatch.setattr(tools, "_execute_cofacts_graphql", mock)
    return mock


def awaited_kwargs(mock: AsyncMock) -> Mapping[str, Any]:
    """The keyword arguments of the last awaited call.

    A helper rather than `mock.await_args.kwargs` inline because `await_args`
    is `_Call | None`, and asserting it here both narrows the type and turns
    "the tool never called the API" into a readable failure.
    """
    call = mock.await_args
    assert call is not None, "the tool never called the GraphQL transport"
    return call.kwargs


def article_node(
    article_id: str,
    text: str,
    fact_check_count: int = 0,
    demand: int = 3,
) -> dict:
    return {
        "id": article_id,
        "text": text,
        "articleType": "TEXT",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "factCheckCount": fact_check_count,
        "communityDemandCount": demand,
    }


def list_articles(nodes: list[dict], total: Optional[int] = None) -> dict:
    return {
        "success": True,
        "data": {
            "ListArticles": {
                "totalCount": len(nodes) if total is None else total,
                "edges": [{"node": node} for node in nodes],
            }
        },
    }


class TestSearchSuspiciousMessages:
    async def test_returns_only_the_fields_needed_to_choose(
        self, monkeypatch, signed_in
    ):
        # Anything extra here would be replayed into the writer's context as
        # flattened text once the conversation transfers, which is the whole
        # reason this tool exists next to search_cofacts_database.
        patch_graphql(
            monkeypatch,
            list_articles([article_node("a1", "台電要停電了", fact_check_count=2)]),
        )

        result = await search_suspicious_messages("台電停電")

        assert result == {
            "data": {
                "totalCount": 1,
                "results": [
                    {
                        "id": "a1",
                        "text": "台電要停電了",
                        "articleType": "TEXT",
                        "createdAt": "2026-08-01T00:00:00.000Z",
                        "factCheckCount": 2,
                        "communityDemandCount": 3,
                    }
                ],
            }
        }

    async def test_truncates_long_text_but_leaves_short_text_alone(
        self, monkeypatch, signed_in
    ):
        long_text = "字" * (_SEARCH_RESULT_TEXT_LIMIT + 50)
        short_text = "字" * _SEARCH_RESULT_TEXT_LIMIT
        patch_graphql(
            monkeypatch,
            list_articles(
                [article_node("a1", long_text), article_node("a2", short_text)]
            ),
        )

        results = (await search_suspicious_messages("字"))["data"]["results"]

        assert results[0]["text"] == "字" * _SEARCH_RESULT_TEXT_LIMIT + "..."
        # Exactly at the limit is not truncated: the ellipsis would be a lie.
        assert results[1]["text"] == short_text

    async def test_passes_the_query_and_limit_through(self, monkeypatch, signed_in):
        mock = patch_graphql(monkeypatch, list_articles([]))

        await search_suspicious_messages("這是謠言嗎", limit=3)

        variables = awaited_kwargs(mock)["variables"]
        assert variables["first"] == 3
        assert variables["filter"]["moreLikeThis"]["like"] == "這是謠言嗎"

    async def test_missing_text_does_not_crash(self, monkeypatch, signed_in):
        # A media article's `text` is its transcript, which can be null.
        node = article_node("a1", "")
        node["text"] = None
        patch_graphql(monkeypatch, list_articles([node]))

        results = (await search_suspicious_messages("圖片"))["data"]["results"]

        assert results[0]["text"] is None

    async def test_graphql_error_is_returned_verbatim(self, monkeypatch, signed_in):
        patch_graphql(monkeypatch, {"error": "GraphQL errors: [...]"})

        result = await search_suspicious_messages("台電停電")

        assert result == {"error": "GraphQL errors: [...]"}

    async def test_searching_works_without_a_signed_in_user(
        self, monkeypatch, signed_out
    ):
        # Reading is public; only request_fact_check needs the user.
        mock = patch_graphql(monkeypatch, list_articles([article_node("a1", "x")]))

        result = await search_suspicious_messages("x")

        assert "error" not in result
        assert awaited_kwargs(mock)["auth_token"] is None


class TestRequestFactCheck:
    async def test_records_the_request_and_reports_the_new_count(
        self, monkeypatch, signed_in
    ):
        mock = patch_graphql(
            monkeypatch,
            {
                "success": True,
                "data": {
                    "CreateOrUpdateReplyRequest": {"id": "a1", "replyRequestCount": 4}
                },
            },
        )

        result = await request_fact_check("a1", "看起來像詐騙")

        assert result == {
            "success": True,
            "article_id": "a1",
            "communityDemandCount": 4,
        }
        assert awaited_kwargs(mock)["variables"] == {
            "articleId": "a1",
            "reason": "看起來像詐騙",
        }
        assert awaited_kwargs(mock)["auth_token"] == "jwt-token"

    async def test_refuses_without_a_signed_in_user_and_does_not_call_the_api(
        self, monkeypatch, signed_out
    ):
        # rumors-api would reject the write anyway; failing here lets the agent
        # say something useful ("please sign in") instead of relaying a 401.
        mock = patch_graphql(monkeypatch, {"success": True, "data": {}})

        result = await request_fact_check("a1", "看起來像詐騙")

        assert result["error"] == "not_authenticated"
        assert "sign in" in result["message"]
        mock.assert_not_awaited()

    async def test_graphql_error_is_returned_verbatim(self, monkeypatch, signed_in):
        patch_graphql(monkeypatch, {"error": "GraphQL errors: [forbidden]"})

        result = await request_fact_check("a1", "理由")

        assert result == {"error": "GraphQL errors: [forbidden]"}

    async def test_null_article_is_reported_as_not_found(self, monkeypatch, signed_in):
        patch_graphql(
            monkeypatch,
            {"success": True, "data": {"CreateOrUpdateReplyRequest": None}},
        )

        result = await request_fact_check("gone", "理由")

        assert result == {"error": "Article not found", "article_id": "gone"}

    async def test_transport_exception_is_caught(self, monkeypatch, signed_in):
        # on_tool_error_callback would catch this too, but the tool returning a
        # readable dict keeps the article id in front of the agent.
        monkeypatch.setattr(
            tools,
            "_execute_cofacts_graphql",
            AsyncMock(side_effect=RuntimeError("boom")),
        )

        result = await request_fact_check("a1", "理由")

        assert result["article_id"] == "a1"
        assert "boom" in result["error"]
