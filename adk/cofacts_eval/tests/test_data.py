import json
import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from cofacts_eval.data import Source, import_cases, load_cases, write_jsonl


def test_source_integrity():
    with pytest.raises(ValidationError, match="matching sha256"):
        Source(
            url="https://example.org",
            text="modified",
            captured_at="2026-01-01",
            sha256="stale",
        )
    with pytest.raises(ValidationError, match="captured_at"):
        Source(url="https://example.org", retrieval_error="timeout")


def test_duplicate_and_split_leakage_rejected(tmp_path, writer_case):
    path = tmp_path / "cases.jsonl"
    write_jsonl(path, [writer_case, writer_case])
    with pytest.raises(ValueError, match="Duplicate"):
        load_cases(path)
    second = writer_case.model_copy(update={"id": "second", "split": "holdout"})
    write_jsonl(path, [writer_case, second])
    with pytest.raises(ValueError, match="both dev and holdout"):
        load_cases(path)


def test_import_preserves_prefix_and_actual_draft_without_future_leakage(tmp_path):
    def trace(i, time, text, env="production"):
        return {
            "id": i,
            "timestamp": time,
            "name": "invocation [cofacts_ai]",
            "sessionId": "s",
            "environment": env,
            "input": {"new_message": {"parts": [{"text": text}]}},
        }

    def obs(i, name, time, trace_id="now", parent="agent", inp=None, out=None, **extra):
        return {
            "id": i,
            "traceId": trace_id,
            "name": name,
            "startTime": time,
            "endTime": time,
            "parentObservationId": parent,
            "input": inp or {},
            "output": out,
            **extra,
        }

    write_jsonl(
        tmp_path / "traces.jsonl",
        [
            trace("prior", "01", "請勿使用問句", "default"),
            trace("now", "10", "請縮短草稿"),
            trace("future", "30", "FUTURE_CORRECTION"),
        ],
    )
    write_jsonl(
        tmp_path / "observations.jsonl",
        [
            obs("prior-agent", "agent_run [writer]", "02", trace_id="prior"),
            obs(
                "prior-gen",
                "generate_content",
                "03",
                trace_id="prior",
                parent="prior-agent",
                type="GENERATION",
                out={"content": {"parts": [{"text": "PRIOR_WRITER"}]}},
            ),
            obs("wrong-agent", "agent_run [verifier]", "04", trace_id="prior"),
            obs(
                "wrong-gen",
                "generate_content",
                "05",
                trace_id="prior",
                parent="wrong-agent",
                type="GENERATION",
                out={"content": {"parts": [{"text": "NOT_PRIOR_WRITER"}]}},
            ),
            obs("agent", "agent_run [writer]", "11"),
            obs(
                "verify",
                "verifier",
                "12",
                inp={"request": "https://example.org/source", "token": "SECRET"},
                out={"content": "FULL_EVIDENCE"},
            ),
            obs(
                "first-draft",
                "draft_factcheck_response",
                "13",
                inp={"text": "PRIOR_DRAFT"},
                out={"success": True},
            ),
            obs(
                "final-draft",
                "draft_factcheck_response",
                "14",
                inp={
                    "text": "ACTUAL_DRAFT",
                    "references": "https://example.org/source",
                },
                out={"success": True, "text": "STATUS_IS_NOT_THE_DRAFT"},
            ),
            obs(
                "rejected",
                "draft_factcheck_response",
                "15",
                inp={"text": "REJECTED"},
                out={"success": False},
            ),
            obs(
                "later-verify",
                "verifier",
                "16",
                inp={"request": "later"},
                out={"content": "FUTURE_EVIDENCE"},
            ),
        ],
    )
    write_jsonl(
        tmp_path / "scores.jsonl",
        [
            {"traceId": "now", "name": "user-thumbs", "value": -1, "updatedAt": "20"},
            {"traceId": "now", "name": "llm-judge", "value": 1, "updatedAt": "21"},
        ],
    )
    cases, _ = import_cases(tmp_path)
    writer = next(c for c in cases if c.target == "writer")
    assert writer.recorded_output == "ACTUAL_DRAFT"
    assert [t.text for t in writer.conversation] == [
        "請勿使用問句",
        "PRIOR_WRITER",
        "請縮短草稿",
    ]
    evidence = json.dumps([e.model_dump() for e in writer.evidence])
    assert "FULL_EVIDENCE" in evidence and "PRIOR_DRAFT" in evidence
    assert all(
        x not in evidence
        for x in ("SECRET", "FUTURE_EVIDENCE", "ACTUAL_DRAFT", "REJECTED")
    )
    assert writer.provenance.user_feedback == -1
    assert writer.review_status == "pending" and writer.expected_checks == []


def test_bundled_cases_are_portable_and_match_manifest():
    root = Path(__file__).resolve().parents[2] / "evals"
    if not (root / "cases.jsonl").is_file():
        pytest.skip("Historical fixtures are local; public CI uses synthetic fixtures")
    cases = load_cases(root / "cases.jsonl")
    manifest = json.loads((root / "manifest.json").read_text())
    assert (
        hashlib.sha256((root / "cases.jsonl").read_bytes()).hexdigest()
        == manifest["cases_sha256"]
    )
    counts = manifest["counts"]
    for target in ("writer", "verifier"):
        assert sum(c.target == target for c in cases) == counts[target]
    assert (
        sum(c.review_status == "pending" for c in cases)
        == counts["pending_human_review"]
    )
    assert all(c.recorded_output and c.request for c in cases)
    assert all("/Users/" not in c.model_dump_json() for c in cases)
    assert (
        sum(
            c.target == "verifier"
            and bool(c.sources)
            and all(s.captured for s in c.sources)
            for c in cases
        )
        == counts["verifier_sources_captured"]
    )
