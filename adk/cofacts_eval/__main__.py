"""Run with `python -m cofacts_eval --help` from adk/."""

import argparse
import asyncio
import json
from pathlib import Path

from .data import case_digest, import_cases, load_cases, read_jsonl, write_jsonl
from .judge import Response, recorded, report, score

DEFAULT_CASES = Path(__file__).resolve().parent.parent / "evals" / "cases.jsonl"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser(
        "import", help="One-time import from a Langfuse raw JSONL directory"
    )
    importer.add_argument("--raw-dir", type=Path, required=True)
    importer.add_argument("--per-agent", type=int, default=20)
    importer.add_argument("--output", type=Path, required=True)
    for command in ("inspect", "run", "score"):
        sub = commands.add_parser(command)
        sub.add_argument("--cases", type=Path, default=DEFAULT_CASES)
        sub.add_argument("--target", choices=("writer", "verifier"))
        sub.add_argument("--split", choices=("dev", "holdout"), default="dev")
        sub.add_argument("--case-id")
        sub.add_argument("--limit", type=int, default=5)
        if command != "inspect":
            sub.add_argument("--output", type=Path, required=True)
        if command == "score":
            sub.add_argument(
                "--responses",
                type=Path,
                help="Candidate responses; omitted means score historical outputs",
            )
            sub.add_argument("--judge-model")
            sub.add_argument(
                "--gate",
                action="store_true",
                help="Fail unless every selected case is human-reviewed and every criterion passes",
            )
    args = parser.parse_args()
    if args.command == "import":
        if args.output.exists():
            parser.error(
                "output exists; use a new path to preserve curated snapshots and labels"
            )
        cases, stats = import_cases(args.raw_dir, args.per_agent)
        if not cases:
            parser.error("no eligible cases; check the export format and environment")
        write_jsonl(args.output, cases)
        print(json.dumps(stats, ensure_ascii=False))
        return
    if args.limit < 1:
        parser.error("limit must be positive")
    if not args.cases.is_file():
        parser.error(
            "case file not found; use the import command to prepare local cases, "
            "or select an existing file with --cases (see docs/evaluation.md)"
        )
    all_cases = load_cases(args.cases)
    cases = [
        c
        for c in all_cases
        if c.split == args.split
        and (not args.target or c.target == args.target)
        and (not args.case_id or c.id == args.case_id)
    ][: args.limit]
    if not cases:
        parser.error("no matching cases (check target, split and case-id)")
    if args.command == "inspect":
        print(
            json.dumps(
                {
                    "total_cases": len(all_cases),
                    "selected": [
                        {
                            "id": c.id,
                            "target": c.target,
                            "split": c.split,
                            "review_status": c.review_status,
                            "source_captures": f"{sum(s.captured for s in c.sources)}/{len(c.sources)}",
                            "turns": len(c.conversation),
                        }
                        for c in cases
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    if args.output.exists():
        parser.error(
            "output exists; use a new path to preserve previous experiment results"
        )
    if args.command == "score" and args.output.with_suffix(".md").exists():
        parser.error("Markdown report exists; use a new output path")
    if args.command == "run":
        from .runtime import generate

        responses = []
        for case in cases:
            print(f"run {case.id}", flush=True)
            responses.append(asyncio.run(generate(case)))
            write_jsonl(args.output, responses)
        if any(r.error for r in responses):
            raise SystemExit(2)
        return
    responses = None
    if args.responses:
        parsed = [Response.model_validate(row) for row in read_jsonl(args.responses)]
        responses = {r.case_id: r for r in parsed}
        if len(responses) != len(parsed):
            parser.error("duplicate candidate response IDs")
        missing = {c.id for c in cases} - responses.keys()
        if missing:
            parser.error("missing candidate responses: " + ", ".join(sorted(missing)))
        if any(responses[c.id].case_sha256 != case_digest(c) for c in cases):
            parser.error("candidate responses do not match the selected case versions")
    rows = []
    for case in cases:
        print(f"score {case.id}", flush=True)
        rows.append(
            score(
                case,
                responses[case.id] if responses is not None else recorded(case),
                args.judge_model,
            )
        )
        write_jsonl(args.output, rows)
    args.output.with_suffix(".md").write_text(report(rows), encoding="utf-8")
    if any(row["error"] for row in rows):
        raise SystemExit(2)
    if args.gate and any(
        row["provisional"] or any(c["verdict"] != "pass" for c in row["checks"])
        for row in rows
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
