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

  * **unpriced tokens** — the usage keys Langfuse actually priced must sum to `total`.
    Anything short of that is tokens Google billed and Langfuse gave away free, whether
    because the key carried no price or because the bucket never arrived at all.
  * **unpriced generations** — a generation carrying tokens must have resolved a model and
    come out with a non-zero cost.

Both are version-independent: they describe what correct output looks like, not what any
particular `openinference-instrumentation-google-adk` release happens to emit. That matters
because the instrumentor is unpinned, and because an upgrade can quietly move which side of
the wire a value arrives on.

`SKILL.md` next to this file says when to run it and how to read a breach.

Usage:

    python3 check_usage.py --from 2026-09-01 --to 2026-10-01
    python3 check_usage.py --from … --to … \
        --max-unpriced-share 0.02 --max-unpriced-generations 0   # exits 1 on breach

    # verify a PR preview deploy before merging, without production drowning it out
    python3 check_usage.py --environment preview --from 2026-09-01 --to 2026-09-02

Standard library only, so it runs anywhere `python3` does — no virtualenv, and nothing to
export by hand. Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL from the
environment, the same variables `adk/instrumentation.py` uses. The key is project-scoped, so
one run sees one Langfuse project — `rumors-api`'s transcripts live in their own.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict


def fetch_generations(
    base_url: str,
    auth: tuple[str, str],
    start: str,
    end: str,
    environment: str | None = None,
) -> list[dict]:
    """Page through every GENERATION observation in the window."""
    credentials = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
    out: list[dict] = []
    page = 1
    while True:
        query = urllib.parse.urlencode(
            {
                "type": "GENERATION",
                "fromStartTime": start,
                "toStartTime": end,
                "limit": 100,
                "page": page,
                **({"environment": environment} if environment else {}),
            }
        )
        request = urllib.request.Request(
            f"{base_url.rstrip('/')}/api/public/observations?{query}",
            headers={
                "Authorization": f"Basic {credentials}",
                "Accept": "application/json",
                # Named explicitly: Cloudflare fronts langfuse.cofacts.tw and
                # answers the default `Python-urllib/3.x` signature with a 403
                # (error 1010) before the request reaches Langfuse.
                "User-Agent": "cofacts-langfuse-usage-check/1.0",
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.load(response)
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


def unpriced_tokens(usage: dict, costs: dict) -> int:
    """Tokens `total` covers that Langfuse attached no price to.

    Two ways a token goes free, and both have to be counted or this passes while
    Google bills us:

    * **A bucket arrived under a key with no price.** This is cause 3 — the
      instrumentor's `completion_details.reasoning` is a well-formed key that no
      managed Gemini definition prices. Summing every key as if it were priced
      would wave exactly that regression through, so `costDetails` decides: it
      comes back from the same endpoint and names the keys that earned a price.
    * **A bucket never arrived.** This is cause 1 — tool-use tokens reach
      Langfuse only inside `total`, which is an aggregate ("not a bucket itself
      but spans all buckets and equals their sum") and cannot be priced. The
      shortfall of `total` over everything received is what makes them visible.

    `total` works as a yardstick only because the plugin ingests Gemini's own
    `total_token_count`. When no total is ingested Langfuse derives one by summing
    the keys it received, and a derived total cannot expose a bucket that is
    missing from those same keys.
    """
    priced_keys = {k for k in costs if k != "total"}
    received = {k: v for k, v in usage.items() if k != "total" and isinstance(v, int)}
    unpriced_keys = sum(v for k, v in received.items() if k not in priced_keys)
    never_sent = max((usage.get("total") or 0) - sum(received.values()), 0)
    return unpriced_keys + never_sent


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--from", dest="start", required=True, help="inclusive, YYYY-MM-DD"
    )
    parser.add_argument("--to", dest="end", required=True, help="exclusive, YYYY-MM-DD")
    parser.add_argument(
        "--environment",
        help="limit to one tracing environment (production / staging / preview). "
        "Deploys set this via LANGFUSE_TRACING_ENVIRONMENT, so it is how a preview "
        "run gets checked on its own.",
    )
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

    scope = f" [{args.environment}]" if args.environment else ""
    print(
        f"Fetching generations{scope} {args.start} .. {args.end} from {base_url}",
        file=sys.stderr,
    )
    generations = fetch_generations(
        base_url,
        (public, secret),
        f"{args.start}T00:00:00Z",
        f"{args.end}T00:00:00Z",
        args.environment,
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
        missing = unpriced_tokens(usage, obs.get("costDetails") or {})
        total_tokens += usage.get("total") or 0
        unpriced += missing
        cost += obs.get("calculatedTotalCost") or 0.0
        if missing:
            by_model[obs.get("model") or "<unresolved>"] += missing
        if (usage.get("total") or 0) and not (obs.get("calculatedTotalCost") or 0.0):
            free_generations += 1

    n = len(generations)
    share = unpriced / total_tokens if total_tokens else 0.0
    print(
        f"\n{'=' * 78}\n{n:,} generations{scope}, {args.start} .. {args.end}\n{'=' * 78}"
    )
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
