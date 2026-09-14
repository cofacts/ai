import pytest

from cofacts_eval.data import Case, Evidence, Provenance, Source, Turn, digest


@pytest.fixture
def writer_case():
    return Case(
        id="writer-test",
        target="writer",
        group_id="test",
        split="dev",
        provenance=Provenance(
            trace_id="trace",
            observation_id="draft",
            session_id="session",
            timestamp="2026-01-01",
            environment="test",
            user_feedback=-1,
        ),
        request="請完成草稿",
        conversation=[
            Turn(role="user", text="請勿使用問句。"),
            Turn(role="user", text="請完成草稿"),
        ],
        evidence=[
            Evidence(
                tool="verifier",
                observation_id="v",
                input={"request": "確認數字"},
                output={
                    "content": "已確認：範例館藏共 12 件。",
                    "sources": [{"url": "https://example.org/source"}],
                },
            )
        ],
        sources=[Source(url="https://example.org/source")],
        recorded_output="範例館藏共 12 件。",
        recorded_draft={
            "text": "範例館藏共 12 件。",
            "classification": "NOT_RUMOR",
            "references": "https://example.org/source 館藏數量",
            "claim_sources": [
                {
                    "claim": "範例館藏共 12 件。",
                    "source_url": "https://example.org/source",
                    "verifier_confirmed": True,
                }
            ],
        },
        review_notes="This historical answer is bad: private curator assessment.",
        expected_checks=["Do not pass this imported label before review"],
    )


@pytest.fixture
def verifier_case(writer_case):
    case = writer_case.model_copy(deep=True)
    case.id = "verifier-test"
    case.target = "verifier"
    case.request = "確認範例館藏共 12 件：https://example.org/source"
    case.conversation = []
    case.evidence = []
    case.recorded_draft = None
    case.sources = [
        Source(
            url="https://example.org/source",
            text="範例館藏共 12 件。",
            captured_at="2026-01-01",
            sha256=digest("範例館藏共 12 件。"),
        )
    ]
    return case
