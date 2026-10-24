"""Portable cases and a one-time importer for Langfuse JSONL exports.

Only the importer reads an export. Judging and candidate generation use the
resulting case file, never the export directory or another repository.
"""

import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(Record):
    url: str
    text: str = ""
    captured_at: str = ""
    scope: Literal["excerpt", "full"] = "excerpt"
    sha256: str = ""
    note: str = ""
    retrieval_error: str | None = None

    @model_validator(mode="after")
    def verify_snapshot(self):
        if self.text:
            if not self.captured_at or self.sha256 != digest(self.text):
                raise ValueError(
                    "A source snapshot needs captured_at and a matching sha256"
                )
            if self.retrieval_error:
                raise ValueError(
                    "A source cannot contain both text and a retrieval error"
                )
        if self.retrieval_error and not self.captured_at:
            raise ValueError("A recorded retrieval failure needs captured_at")
        return self

    @property
    def captured(self) -> bool:
        return bool(self.text or self.retrieval_error)


class Turn(Record):
    role: Literal["user", "assistant"]
    text: str


class Evidence(Record):
    tool: str
    observation_id: str
    input: dict[str, Any]
    output: Any


class Provenance(Record):
    trace_id: str
    observation_id: str
    session_id: str
    timestamp: str
    environment: str
    user_feedback: Literal[-1, 0, 1] | None = None


class Case(Record):
    schema_version: Literal[1] = 1
    id: str
    target: Literal["verifier", "writer"]
    group_id: str
    split: Literal["dev", "holdout"]
    provenance: Provenance
    request: str
    conversation: list[Turn] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    recorded_output: str
    recorded_draft: dict[str, Any] | None = None
    # Human labels are optional. Imported feedback/model answers are NOT labels.
    review_status: Literal["pending", "human_reviewed"] = "pending"
    review_notes: str = ""
    expected_checks: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def verify_review(self):
        if self.review_status == "human_reviewed" and (
            not self.expected_checks or not self.review_notes.strip()
        ):
            raise ValueError(
                "Human-reviewed cases need expected_checks and review_notes"
            )
        return self


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def case_digest(case: Case) -> str:
    return digest(json.dumps(case.model_dump(), sort_keys=True, ensure_ascii=False))


def decode(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            pass
    return value


def read_jsonl(path: Path):
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except ValueError as error:
                    raise ValueError(f"{path.name}:{number}: invalid JSON") from error


def load_cases(path: Path) -> list[Case]:
    cases = [Case.model_validate(row) for row in read_jsonl(path)]
    if len({case.id for case in cases}) != len(cases):
        raise ValueError("Duplicate case IDs")
    groups: dict[str, str] = {}
    for case in cases:
        if groups.setdefault(case.group_id, case.split) != case.split:
            raise ValueError("One group cannot appear in both dev and holdout")
    return cases


def write_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            value = row.model_dump() if isinstance(row, BaseModel) else row
            handle.write(json.dumps(value, ensure_ascii=False) + "\n")


def content_text(value: Any) -> str:
    value = decode(value)
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    for key in ("content", "result"):
        if isinstance(value.get(key), str):
            return content_text(value[key])
    content = value.get("content", value)
    if isinstance(content, dict):
        return "\n".join(
            part["text"]
            for part in content.get("parts", [])
            if isinstance(part, dict)
            and isinstance(part.get("text"), str)
            and not part.get("thought")
        )
    return ""


_URL = re.compile(r"https?://[^\s<>\"'\]\)）}]+")
_PRIVATE_KEYS = {
    "authorization",
    "token",
    "access_token",
    "refresh_token",
    "user_id",
    "userId",
}


def clean(value: Any) -> Any:
    """Keep task content, excluding account IDs, credentials and widget HTML."""
    if isinstance(value, dict):
        return {
            key: clean(item)
            for key, item in value.items()
            if key not in _PRIVATE_KEYS and key != "_search_widget_html"
        }
    if isinstance(value, list):
        return [clean(item) for item in value]
    return value


def urls(text: str) -> list[str]:
    return list(dict.fromkeys(url.rstrip(".,;，。；") for url in _URL.findall(text)))


def _time(row: dict) -> str:
    return row.get("startTime") or row.get("timestamp") or ""


def _agent(row: dict, index: dict[str, dict]) -> str:
    seen = set()
    while row and row["id"] not in seen:
        seen.add(row["id"])
        name = row.get("name", "")
        if name.startswith("agent_run ["):
            return name[len("agent_run [") : -1]
        row = index.get(row.get("parentObservationId"), {})
    return ""


def import_cases(raw: Path, per_agent: int = 20) -> tuple[list[Case], dict]:
    """Select balanced, text-only production examples, at most one per group/target.

    Writer cases target the final successful draft tool call. Evidence ends
    BEFORE that call; conversation ends at the current user turn. Thus later
    corrections, reviews and user scores never leak into judge inputs.
    """
    if per_agent < 1:
        raise ValueError("per_agent must be positive")
    traces = {
        row["id"]: row
        for row in read_jsonl(raw / "traces.jsonl")
        if row.get("name") == "invocation [cofacts_ai]"
    }
    by_trace: dict[str, list[dict]] = defaultdict(list)
    # No pandas, SDK, config, credentials or imports from the exporting project.
    for row in read_jsonl(raw / "observations.jsonl"):
        if row.get("traceId") in traces:
            by_trace[row["traceId"]].append(row)
    feedback = {}
    for row in sorted(
        read_jsonl(raw / "scores.jsonl"), key=lambda r: r.get("updatedAt", "")
    ):
        if row.get("name") == "user-thumbs" and row.get("value") in (-1, 0, 1):
            feedback[row.get("traceId")] = int(row["value"])
    index = {row["id"]: row for rows in by_trace.values() for row in rows}
    sessions: dict[str, list[dict]] = defaultdict(list)
    for trace in traces.values():
        sessions[trace.get("sessionId") or trace["id"]].append(trace)

    def last_writer(trace_id: str) -> str:
        generations = sorted(by_trace.get(trace_id, []), key=_time, reverse=True)
        return next(
            (
                text
                for row in generations
                if row.get("type") == "GENERATION" and _agent(row, index) == "writer"
                if (text := content_text(row.get("output")))
            ),
            "",
        )

    candidates = []
    skipped = defaultdict(int)
    source_tools = {
        "verifier",
        "investigator",
        "get_single_cofacts_article",
        "search_cofacts_database",
        "draft_factcheck_response",
    }
    for trace_id, trace in sorted(
        traces.items(), key=lambda pair: pair[1]["timestamp"]
    ):
        if trace.get("environment") != "production":
            continue
        rows = sorted(by_trace.get(trace_id, []), key=_time)
        sid = trace.get("sessionId") or trace_id
        prior = sorted(
            (t for t in sessions[sid] if t["timestamp"] <= trace["timestamp"]),
            key=lambda t: t["timestamp"],
        )
        conversation = []
        for turn in prior:
            inp = decode(turn.get("input")) or {}
            text = content_text(inp.get("new_message"))
            if text:
                conversation.append(Turn(role="user", text=text))
            if turn["id"] != trace_id and (answer := last_writer(turn["id"])):
                conversation.append(Turn(role="assistant", text=answer))
        request = content_text((decode(trace.get("input")) or {}).get("new_message"))
        group_anchor = next(
            (
                url
                for turn in conversation
                for url in urls(turn.text)
                if "cofacts.tw/article/" in url
            ),
            sid,
        )
        group = digest(group_anchor)[:16]
        split = "holdout" if int(group[:8], 16) % 5 == 0 else "dev"
        drafts = [
            row
            for row in rows
            if row.get("name") == "draft_factcheck_response"
            and isinstance(decode(row.get("output")), dict)
            and decode(row["output"]).get("success") is True
            and _agent(row, index) == "writer"
        ]
        targets: list[tuple[Literal["verifier", "writer"], dict]] = [
            ("verifier", row) for row in rows if row.get("name") == "verifier"
        ]
        if drafts:
            targets.append(("writer", drafts[-1]))
        for target, row in targets:
            inp = clean(decode(row.get("input")))
            out = clean(decode(row.get("output")))
            if not isinstance(inp, dict):
                skipped["invalid_input"] += 1
                continue
            task = inp.get("request", "") if target == "verifier" else request
            answer = content_text(out) if target == "verifier" else inp.get("text", "")
            if (
                not task
                or not answer
                or answer.strip() == "<not specified>"
                or (isinstance(out, dict) and "error" in out)
            ):
                skipped["empty_or_error"] += 1
                continue
            if target == "verifier" and re.search(
                r"gs://|youtu(?:be\.com|\.be)|watch (?:this|the) video", task, re.I
            ):
                skipped["multimodal_verifier"] += 1
                continue
            # Same-session evidence, strictly completed before the target call.
            evidence = (
                [
                    Evidence(
                        tool=e["name"],
                        observation_id=e["id"],
                        input=clean(decode(e.get("input")) or {}),
                        output=clean(decode(e.get("output"))),
                    )
                    for t in prior
                    for e in sorted(by_trace.get(t["id"], []), key=_time)
                    if e.get("name") in source_tools
                    # Earlier drafts are needed for revision requests, but the target
                    # draft and later output must never become their own evidence.
                    and e["id"] != row["id"]
                    and (e.get("endTime") or _time(e)) < _time(row)
                    and isinstance(decode(e.get("input")), dict)
                ]
                if target == "writer"
                else []
            )
            if target == "writer" and not any(e.tool == "verifier" for e in evidence):
                skipped["writer_without_verification"] += 1
                continue
            source_urls = (
                urls(task) if target == "verifier" else urls(inp.get("references", ""))
            )
            case = Case(
                id=f"{target}-{row['id']}",
                target=target,
                group_id=group,
                split=split,
                provenance=Provenance(
                    trace_id=trace_id,
                    observation_id=row["id"],
                    session_id=sid,
                    timestamp=_time(row),
                    environment="production",
                    user_feedback=feedback.get(trace_id),
                ),
                request=task,
                conversation=conversation if target == "writer" else [],
                evidence=evidence,
                sources=[Source(url=u) for u in source_urls],
                recorded_output=answer,
                recorded_draft=inp if target == "writer" else None,
                review_notes="Historical output and user feedback are not ground truth. Source snapshots/labels require independent review.",
            )
            if len(case.model_dump_json()) > 180_000:
                skipped["oversized_no_truncation"] += 1
                continue
            candidates.append(case)
    selected = []
    for target in ("verifier", "writer"):
        pools = {
            label: sorted(
                (
                    c
                    for c in candidates
                    if c.target == target and c.provenance.user_feedback == label
                ),
                key=lambda c: (c.provenance.timestamp, c.id),
                reverse=True,
            )
            for label in (-1, 1, None, 0)
        }
        seen = set()
        while len(seen) < per_agent:
            added = False
            for pool in pools.values():
                while pool and pool[0].group_id in seen:
                    pool.pop(0)
                if pool and len(seen) < per_agent:
                    case = pool.pop(0)
                    selected.append(case)
                    seen.add(case.group_id)
                    added = True
            if not added:
                break
    return selected, {
        "eligible": len(candidates),
        "selected": len(selected),
        "skipped": dict(skipped),
    }
