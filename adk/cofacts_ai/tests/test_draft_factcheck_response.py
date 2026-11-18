"""`draft_factcheck_response`'s article_ids check: the frontend submits the reply to exactly
these articles, so they must be plain Cofacts IDs."""

import pytest

from cofacts_ai.tools import draft_factcheck_response

REFERENCES = "https://example.com/a 來源摘要"


def draft(article_ids):
    return draft_factcheck_response(
        classification="NOT_ARTICLE",
        text="這則訊息不在查證範圍。",
        references=REFERENCES,
        article_ids=article_ids,
    )


@pytest.mark.parametrize("article_ids", [["abc123"], ["AVxY-z_9", "2ytizmsgiuqpx"], []])
def test_accepts_ids(article_ids):
    assert draft(article_ids)["success"] is True


@pytest.mark.parametrize(
    "article_ids",
    [
        ["https://cofacts.tw/article/abc123"],
        [""],
        ["abc 123"],
        "abc123",
        [123],
    ],
)
def test_rejects_urls_and_non_ids(article_ids):
    result = draft(article_ids)
    assert result["success"] is False
    assert "article_ids" in result["text"]
