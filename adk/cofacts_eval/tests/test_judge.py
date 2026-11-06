import json
from unittest.mock import Mock

import pytest

from cofacts_eval import judge
from cofacts_eval.data import Source, case_digest
from cofacts_eval.judge import (
    Check,
    Judgment,
    RUBRICS,
    grading_input,
    recorded,
    score,
    validate_judgment,
)


def judgment(case, verdict="pass", **quotes):
    return Judgment(
        checks=[
            Check(
                criterion=k,
                verdict=verdict,
                reason="Test assessment",
                confidence=0.8,
                candidate_quote=quotes.get("candidate_quote", ""),
                evidence_quote=quotes.get("evidence_quote", ""),
            )
            for k in RUBRICS[case.target]
        ],
        summary="Test result",
    )


def test_judge_does_not_see_feedback_or_reference_answer(writer_case):
    response = recorded(writer_case).model_copy(
        update={"output": "NEW_OUTPUT", "draft": {"text": "NEW_DRAFT"}}
    )
    writer_case.recorded_output = "SECRET_REFERENCE"
    writer_case.recorded_draft = {"text": "SECRET_DRAFT"}
    data = json.dumps(grading_input(writer_case, response))
    assert all(
        x not in data
        for x in (
            "SECRET_REFERENCE",
            "SECRET_DRAFT",
            "private curator",
            "user_feedback",
            "Do not pass",
        )
    )
    assert "NEW_OUTPUT" in data and "NEW_DRAFT" in data


def test_missing_sources_never_pass_or_call_judge(monkeypatch, verifier_case):
    verifier_case.sources = [Source(url="https://example.org/source")]
    backend = Mock(side_effect=AssertionError("must not call judge"))
    monkeypatch.setattr(judge, "codex_json", backend)
    result = score(verifier_case, recorded(verifier_case))
    assert {c["verdict"] for c in result["checks"]} == {"unclear"}
    assert not result["judge_called"]
    backend.assert_not_called()


def test_known_retrieval_failure_can_be_evaluated(monkeypatch, verifier_case):
    verifier_case.sources = [
        Source(
            url="https://example.org/source",
            captured_at="2026-01-01",
            retrieval_error="timeout",
        )
    ]
    backend = Mock(return_value=judgment(verifier_case, "fail").model_dump())
    monkeypatch.setattr(judge, "codex_json", backend)
    result = score(verifier_case, recorded(verifier_case))
    assert result["judge_called"] and result["checks"][0]["verdict"] == "fail"


@pytest.mark.parametrize(
    "kind", ["missing", "duplicate", "fabricated_candidate", "fabricated_evidence"]
)
def test_invalid_judge_results_rejected(writer_case, kind):
    result = judgment(writer_case)
    if kind == "missing":
        result.checks.pop()
    elif kind == "duplicate":
        result.checks[-1] = result.checks[0]
    elif kind == "fabricated_candidate":
        result.checks[0].candidate_quote = "MADE_UP"
    else:
        result.checks[0].evidence_quote = "MADE_UP"
    with pytest.raises(ValueError):
        validate_judgment(writer_case, recorded(writer_case), result)


def test_verbatim_quotes_and_provisional_result(monkeypatch, writer_case):
    backend = Mock(
        return_value=judgment(
            writer_case,
            candidate_quote="範例館藏共 12 件。",
            evidence_quote="請勿使用問句。",
        ).model_dump()
    )
    monkeypatch.setattr(judge, "codex_json", backend)
    result = score(writer_case, recorded(writer_case), "test-model")
    assert result["provisional"] and not result["error"]
    assert result["case_sha256"] == case_digest(writer_case)
    assert result["judge_model"] == "test-model"


def test_errors_and_version_mismatch_are_not_agent_failures(monkeypatch, writer_case):
    response = recorded(writer_case)
    response.case_sha256 = "stale"
    with pytest.raises(ValueError, match="case version"):
        score(writer_case, response)
    monkeypatch.setattr(judge, "codex_json", Mock(side_effect=RuntimeError("timeout")))
    result = score(writer_case, recorded(writer_case))
    assert result["error"] == "timeout"
    assert {c["verdict"] for c in result["checks"]} == {"unclear"}
    response = recorded(writer_case).model_copy(update={"error": "model unavailable"})
    assert {c["verdict"] for c in score(writer_case, response)["checks"]} == {"unclear"}


def test_writer_must_produce_a_draft(writer_case):
    response = recorded(writer_case).model_copy(
        update={"draft": None, "output": "I will draft it later"}
    )
    result = score(writer_case, response)
    assert not result["judge_called"]
    assert {c["verdict"] for c in result["checks"]} == {"fail"}


def test_format_rule_is_valid_evidence_for_constraint_judgment(writer_case):
    result = judgment(writer_case)
    check = next(c for c in result.checks if c.criterion == "constraint_adherence")
    check.evidence_quote = "草稿 text 須純文字、不含 Markdown、URL 或引文標記"
    assert validate_judgment(writer_case, recorded(writer_case), result) is result


@pytest.mark.parametrize("quote", ["已確認", "共 12 件。\\n請保留限制。"])
def test_rewritten_markup_and_literal_newline_quotes_are_rejected(writer_case, quote):
    writer_case.evidence[0].output = {"content": "已**確認**：共 12 件。\n請保留限制。"}
    result = judgment(writer_case, evidence_quote=quote)
    with pytest.raises(ValueError, match="evidence quote"):
        validate_judgment(writer_case, recorded(writer_case), result)
