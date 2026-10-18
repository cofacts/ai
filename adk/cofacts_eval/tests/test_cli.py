import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

from cofacts_eval import __main__ as cli
from cofacts_eval import judge
from cofacts_eval.data import write_jsonl
from cofacts_eval.judge import recorded


def test_cli_preserves_results_and_pending_cases_cannot_gate(
    monkeypatch, tmp_path, writer_case
):
    path, out = tmp_path / "cases.jsonl", tmp_path / "scores.jsonl"
    write_jsonl(path, [writer_case])
    backend = Mock(
        return_value={
            "checks": [
                {
                    "criterion": k,
                    "verdict": "pass",
                    "reason": "test",
                    "candidate_quote": "",
                    "evidence_quote": "",
                    "confidence": 1,
                }
                for k in judge.RUBRICS["writer"]
            ],
            "summary": "test",
        }
    )
    monkeypatch.setattr(judge, "codex_json", backend)
    monkeypatch.setattr(
        sys,
        "argv",
        ["cofacts_eval", "score", "--cases", str(path), "--output", str(out), "--gate"],
    )
    with pytest.raises(SystemExit) as exit_info:
        cli.main()
    assert exit_info.value.code == 1
    assert out.exists() and out.with_suffix(".md").exists()
    before = out.read_bytes()
    with pytest.raises(SystemExit) as exit_info:
        cli.main()
    assert exit_info.value.code == 2 and out.read_bytes() == before
    backend.assert_called_once()


def test_cli_validates_all_response_hashes_before_judging(
    monkeypatch, tmp_path, writer_case
):
    other = writer_case.model_copy(update={"id": "second"})
    cases_path, responses_path = tmp_path / "cases.jsonl", tmp_path / "responses.jsonl"
    write_jsonl(cases_path, [writer_case, other])
    write_jsonl(
        responses_path,
        [
            recorded(writer_case),
            recorded(other).model_copy(update={"case_sha256": "stale"}),
        ],
    )
    backend = Mock()
    monkeypatch.setattr(judge, "codex_json", backend)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "cofacts_eval",
            "score",
            "--cases",
            str(cases_path),
            "--responses",
            str(responses_path),
            "--output",
            str(tmp_path / "scores.jsonl"),
        ],
    )
    with pytest.raises(SystemExit) as exit_info:
        cli.main()
    assert exit_info.value.code == 2
    backend.assert_not_called()


def test_codex_contract_uses_stdin_schema_and_isolated_directory(monkeypatch):
    def run(command, **kwargs):
        assert kwargs["input"] == "synthetic test prompt"
        assert "--ignore-user-config" in command and "--ephemeral" in command
        assert "shell_tool" in command and "plugins" in command
        assert 'web_search="disabled"' in command
        assert command[-1] == "-"
        assert command[command.index("--sandbox") + 1] == "read-only"
        root = Path(kwargs["cwd"])
        assert not (root / "AGENTS.md").exists()
        output = Path(command[command.index("--output-last-message") + 1])
        output.write_text('{"ok": true}')
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(judge.shutil, "which", lambda _: "/fake/codex")
    monkeypatch.setattr(judge.subprocess, "run", run)
    assert judge.codex_json("synthetic test prompt", {"type": "object"}) == {"ok": True}


def test_score_runs_from_unrelated_directory_without_adk_or_export_repo(
    tmp_path, verifier_case
):
    # A fresh interpreter can grade a missing-evidence case with only this
    # project's package + pydantic; no Google auth, network or export path.
    verifier_case.sources = []
    cases_path, out = tmp_path / "cases.jsonl", tmp_path / "scores.jsonl"
    write_jsonl(cases_path, [verifier_case])
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])}
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "cofacts_eval",
            "score",
            "--cases",
            str(cases_path),
            "--output",
            str(out),
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    row = json.loads(out.read_text())
    assert not row["judge_called"] and row["checks"][0]["verdict"] == "unclear"
