#!/usr/bin/env python
"""
Check that Langfuse is pricing our Gemini generations completely.

Langfuse computes cost from `usageDetails` keys matched *exactly* against a model
definition's price keys, at ingestion time and with no backfill. A token in a key with no
price — or on an observation whose model name never resolved — is silently free, which is
how Langfuse came to under-report real Vertex AI spend by ~2x. See
`docs/decisions/20260730-langfuse-usage-mapping.md` for the full diagnosis; the fix lives in
`LangfuseTracingPlugin.after_model_callback`.

This is the standing regression check for that fix. It asserts two invariants over a window
of generations:

  * **unpriced tokens** — the priced usage keys must sum to `total`. Anything short of that
    is tokens Google billed and Langfuse gave away free.
  * **unpriced generations** — a generation carrying tokens must have resolved a model and
    come out with a non-zero cost.

Both are version-independent: they describe what correct output looks like, not what any
particular `openinference-instrumentation-google-adk` release happens to emit. That matters
because the instrumentor is unpinned, and because an upgrade can quietly move which side of
the wire a value arrives on.

Usage:

    uv run python scripts/langfuse_check_usage.py --from 2026-09-01 --to 2026-10-01
    uv run python scripts/langfuse_check_usage.py --from … --to … \
        --max-unpriced-share 0.02 --max-unpriced-generations 0   # exits 1 on breach

Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL from the environment,
the same variables `instrumentation.py` uses. The key is project-scoped, so one run sees one
Langfuse project — `rumors-api`'s transcripts live in their own.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

import httpx


def fetch_generations(
    base_url: str, auth: tuple[str, str], start: str, end: str
) -> list[dict]:
    """Page through every GENERATION observation in the window."""
    out: list[dict] = []
    with httpx.Client(base_url=base_url, auth=auth, timeout=120.0) as client:
        page = 1
        while True:
            resp = client.get(
                "/api/public/observations",
                params={
                    "type": "GENERATION",
                    "fromStartTime": start,
                    "toStartTime": end,
                    "limit": 100,
                    "page": page,
                },
            )
            resp.raise_for_status()
            body = resp.json()
            batch = body.get("data") or []
            out.extend(batch)
            meta = body.get("meta") or {}
            print(
                f"  page {page}/{meta.get('totalPages', '?')} ({len(out)} so far)",
                file=sys.stderr,
            )
            if page >= (meta.get("totalPages") or 0) or not batch:
                return out
            page += 1


def unpriced_tokens(usage: dict) -> int:
    """Tokens inside `total` that no priced key accounts for.

    `total` is Langfuse's derived aggregate — "not a bucket itself but spans all buckets and
    equals their sum" — so any shortfall is a bucket that was never sent, or was sent under a
    key with no price.
    """
    total = usage.get("total") or 0
    priced = sum(v for k, v in usage.items() if k != "total" and isinstance(v, int))
    return max(total - priced, 0)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--from", dest="start", required=True, help="inclusive, YYYY-MM-DD"
    )
    parser.add_argument("--to", dest="end", required=True, help="exclusive, YYYY-MM-DD")
    parser.add_argument(
        "--max-unpriced-share",
        type=float,
        help="fail if the unpriced share of all tokens exceeds this (0-1)",
    )
    parser.add_argument(
        "--max-unpriced-generations",
        type=int,
        help="fail if more than this many token-carrying generations cost $0",
    )
    args = parser.parse_args()

    public, secret = os.getenv("LANGFUSE_PUBLIC_KEY"), os.getenv("LANGFUSE_SECRET_KEY")
    base_url = os.getenv("LANGFUSE_BASE_URL") or os.getenv("LANGFUSE_HOST")
    if not (public and secret and base_url):
        print(
            "Set LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL.",
            file=sys.stderr,
        )
        return 2

    print(
        f"Fetching generations {args.start} .. {args.end} from {base_url}",
        file=sys.stderr,
    )
    generations = fetch_generations(
        base_url, (public, secret), f"{args.start}T00:00:00Z", f"{args.end}T00:00:00Z"
    )
    if not generations:
        print("No generations in window.", file=sys.stderr)
        return 0

    total_tokens = unpriced = free_generations = 0
    cost = 0.0
    # Group the unpriced tokens by model, so a breach points at where to look.
    by_model: dict[str, int] = defaultdict(int)

    for obs in generations:
        usage = obs.get("usageDetails") or {}
        missing = unpriced_tokens(usage)
        total_tokens += usage.get("total") or 0
        unpriced += missing
        cost += obs.get("calculatedTotalCost") or 0.0
        if missing:
            by_model[obs.get("model") or "<unresolved>"] += missing
        if (usage.get("total") or 0) and not (obs.get("calculatedTotalCost") or 0.0):
            free_generations += 1

    n = len(generations)
    share = unpriced / total_tokens if total_tokens else 0.0
    print(f"\n{'=' * 78}\n{n:,} generations, {args.start} .. {args.end}\n{'=' * 78}")
    print(f"  reported cost                         ${cost:>12.3f}")
    print(f"  tokens in `total`                      {total_tokens:>12,}")
    print(
        f"  of those, unpriced                     {unpriced:>12,}  ({share * 100:.1f}%)"
    )
    print(f"  token-carrying generations at $0       {free_generations:>12,} / {n:,}")
    if by_model:
        print("\n  unpriced tokens by model:")
        for model, tokens in sorted(by_model.items(), key=lambda kv: -kv[1]):
            print(f"    {model:<40}{tokens:>12,}")

    failures = []
    if args.max_unpriced_share is not None and share > args.max_unpriced_share:
        failures.append(f"unpriced share {share:.3f} > {args.max_unpriced_share}")
    if (
        args.max_unpriced_generations is not None
        and free_generations > args.max_unpriced_generations
    ):
        failures.append(
            f"$0 generations {free_generations} > {args.max_unpriced_generations}"
        )
    if failures:
        print("\nFAIL: " + "; ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
