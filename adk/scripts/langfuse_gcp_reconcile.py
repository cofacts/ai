#!/usr/bin/env python
"""
Reconcile Langfuse-reported LLM cost against the GCP Vertex AI bill.

Langfuse computes cost from `usageDetails` keys, matched *exactly* against the price keys of a
model definition, at ingestion time. Any token that lands in a key with no price — or on an
observation whose model name never resolved — is silently free. That makes it possible for
Langfuse to under-report real spend by ~2x while looking perfectly healthy.

This script quantifies that. It pulls generations from the Langfuse API, re-prices them using the
effective per-token rates *derived from the billing CSV itself* (rather than hardcoded list
prices, so it survives repricing and new models), and prints where the two sides diverge.

It also emits two health metrics that work as a standing regression check, no CSV needed:

  * bucket mismatch — share of generations where the priced usage keys don't sum to `total`.
    Every such token is billed by Google and free in Langfuse.
  * unpriced models — generations whose model name never resolved, so the whole call cost $0.

Usage:

    # full reconciliation against a bill
    uv run python scripts/langfuse_gcp_reconcile.py \
        --billing-csv ~/Downloads/ocf-ikalatv-20260701-20260731.csv \
        --from 2026-07-01 --to 2026-08-01

    # health check only (no bill needed) — non-zero exit if thresholds are breached
    uv run python scripts/langfuse_gcp_reconcile.py --from 2026-07-01 --to 2026-08-01 \
        --max-bucket-mismatch 0.02 --max-unpriced-models 0

Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL from the environment, the
same variables `adk/instrumentation.py` uses. Note the API key is project-scoped, so this only
sees one Langfuse project per run.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field

import httpx

# Langfuse stores the OTel attribute `llm.token_count.completion_details.reasoning` under this
# usage key. No Langfuse-managed Gemini model definition prices it (they price `output_reasoning`
# / `thoughtsTokenCount`), so thinking tokens are free unless we map them ourselves.
REASONING_KEY = "completion_details.reasoning"

# Modality words that separate the family prefix from the direction in a Vertex SKU description,
# e.g. "Gemini 3.1 Flash Lite Global | Video | Input - Predictions".
_MODALITIES = ("text", "video", "audio", "image")

# SKU noise that isn't part of the model family name.
_SKU_NOISE = re.compile(r"\b(ga|global|thinking|predictions)\b|\(.*?\)")

# SKUs that aren't per-token chat generation and have no Langfuse counterpart.
_NON_CHAT_SKU = re.compile(r"embedding|grounding with google search", re.I)


def canonical_family(name: str) -> str:
    """
    Normalize a Vertex SKU description or a Langfuse model id to a shared family key.

        "Gemini 3.1 Flash Lite Global Video Input - Predictions" -> "gemini 3.1 flash lite"
        "gemini-3.1-flash-lite-preview"                          -> "gemini 3.1 flash lite"
    """
    text = name.strip().lower().replace("-", " ").replace("_", " ")
    text = text.split(" - ")[0]
    # Cut the SKU at its modality word, which always follows the family name.
    for modality in _MODALITIES:
        idx = text.find(f" {modality} ")
        if idx != -1:
            text = text[:idx]
            break
    text = _SKU_NOISE.sub(" ", text)
    # Version-suffixed and preview model ids belong to their base family.
    text = re.sub(r"\b(preview|exp|latest|\d{3,})\b", " ", text)
    return " ".join(text.split())


def sku_kind(sku: str) -> str:
    """Classify a SKU as cached input, plain input, or output."""
    low = sku.lower()
    if "caching" in low:
        return "cached"
    if "output" in low:
        return "output"
    return "input"


@dataclass
class Bucket:
    tokens: int = 0
    cost: float = 0.0


@dataclass
class Family:
    """One model family's billed tokens and cost, split by direction."""

    buckets: dict[str, Bucket] = field(default_factory=lambda: defaultdict(Bucket))

    @property
    def cost(self) -> float:
        return sum(b.cost for b in self.buckets.values())

    def rate(self, *kinds: str) -> float:
        """Effective $/token across the given buckets — blends the cache discount in."""
        tokens = sum(self.buckets[k].tokens for k in kinds if k in self.buckets)
        cost = sum(self.buckets[k].cost for k in kinds if k in self.buckets)
        return cost / tokens if tokens else 0.0


@dataclass
class Bill:
    families: dict[str, Family]
    line_item_total: float = 0.0
    non_chat: float = 0.0
    #: The export's own "Filtered total" row, which is authoritative — GCP's per-row
    #: "Unrounded subtotal" values don't always sum to it exactly.
    stated_total: float | None = None

    @property
    def chat(self) -> float:
        return self.line_item_total - self.non_chat


def load_billing(path: str) -> Bill:
    """Parse a GCP billing export grouped by SKU into per-family buckets."""
    bill = Bill(families=defaultdict(Family))
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle):
            sku = (row.get("SKU description") or "").strip()
            try:
                cost = float(row.get("Unrounded subtotal ($)") or 0)
            except ValueError:
                continue
            if not sku:
                # Trailing summary rows: the label sits in a shifted column.
                if "filtered total" in " ".join(v or "" for v in row.values()).lower():
                    bill.stated_total = cost
                continue
            try:
                tokens = int((row.get("Usage amount") or "0").replace(",", ""))
            except ValueError:
                continue
            bill.line_item_total += cost
            if _NON_CHAT_SKU.search(sku):
                bill.non_chat += cost
                continue
            bucket = bill.families[canonical_family(sku)].buckets[sku_kind(sku)]
            bucket.tokens += tokens
            bucket.cost += cost
    return bill


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


@dataclass
class Split:
    """A generation's tokens, split into what Langfuse priced and what it silently dropped."""

    input_priced: int = 0
    input_tool_use: int = 0
    output_priced: int = 0
    output_reasoning: int = 0
    bucket_mismatch: bool = False

    @property
    def input_total(self) -> int:
        return self.input_priced + self.input_tool_use

    @property
    def output_total(self) -> int:
        return self.output_priced + self.output_reasoning


def split_usage(usage: dict) -> Split:
    """
    Separate a generation's tokens into priced and unpriced.

    Two span shapes exist in practice. Fully-attributed spans set `output` from
    `gen_ai.usage.output_tokens` (candidates only), so reasoning is *additive* and the leftover
    `total - input - output - reasoning` is `toolUsePromptTokenCount` — a field Gemini reports
    separately from `promptTokenCount`, bills at the input rate, and that no OTel attribute
    carries. Truncated spans (no `gen_ai.*` attributes) instead set `output` from
    `llm.token_count.completion`, which already includes reasoning; there, input + output == total
    and nothing is missing.
    """
    total = usage.get("total") or 0
    inp = usage.get("input") or 0
    out = usage.get("output") or 0
    reasoning = usage.get(REASONING_KEY) or 0

    if inp + out == total:
        # Truncated-span shape: `output` already subsumes reasoning, nothing unaccounted for.
        return Split(input_priced=inp, output_priced=out)

    leftover = total - inp - out - reasoning
    return Split(
        input_priced=inp,
        input_tool_use=max(leftover, 0),
        output_priced=out,
        output_reasoning=reasoning,
        bucket_mismatch=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--billing-csv",
        help="GCP billing export grouped by SKU. Omit for health check only.",
    )
    parser.add_argument(
        "--from", dest="start", required=True, help="inclusive start date, YYYY-MM-DD"
    )
    parser.add_argument(
        "--to", dest="end", required=True, help="exclusive end date, YYYY-MM-DD"
    )
    parser.add_argument(
        "--fallback-family",
        default="gemini 3 flash",
        help="family used to price generations whose model never resolved (default: %(default)s)",
    )
    parser.add_argument(
        "--max-bucket-mismatch",
        type=float,
        help="fail if the mismatch share exceeds this (0-1)",
    )
    parser.add_argument(
        "--max-unpriced-models",
        type=int,
        help="fail if more than this many generations lack a model",
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

    start, end = f"{args.start}T00:00:00Z", f"{args.end}T00:00:00Z"
    print(
        f"Fetching generations {args.start} .. {args.end} from {base_url}",
        file=sys.stderr,
    )
    generations = fetch_generations(base_url, (public, secret), start, end)
    if not generations:
        print("No generations in window.", file=sys.stderr)
        return 0

    # ---- Langfuse side -------------------------------------------------------------------
    per_family: dict[str, Split] = defaultdict(Split)
    per_agent: dict[str, Split] = defaultdict(Split)
    reported = 0.0
    unpriced_models = 0
    mismatches = 0

    for obs in generations:
        split = split_usage(obs.get("usageDetails") or {})
        reported += obs.get("calculatedTotalCost") or 0.0
        mismatches += split.bucket_mismatch

        model = obs.get("model")
        if model:
            family = canonical_family(model)
        else:
            family = args.fallback_family
            unpriced_models += 1

        agent = ((obs.get("metadata") or {}).get("attributes") or {}).get(
            "gen_ai.agent.name"
        ) or "<unattributed>"
        for key, acc in ((family, per_family), (agent, per_agent)):
            target = acc[key]
            target.input_priced += split.input_priced
            target.input_tool_use += split.input_tool_use
            target.output_priced += split.output_priced
            target.output_reasoning += split.output_reasoning

    n = len(generations)
    print(
        f"\n{'=' * 92}\nLANGFUSE HEALTH — {n:,} generations, {args.start} .. {args.end}\n{'=' * 92}"
    )
    print(f"  reported cost                                   ${reported:>10.3f}")
    print(
        f"  bucket mismatch (priced keys != total)  {mismatches:>6,} / {n:,}  ({mismatches / n * 100:.1f}%)"
    )
    print(
        f"  model never resolved -> whole call $0    {unpriced_models:>6,} / {n:,}  ({unpriced_models / n * 100:.1f}%)"
    )

    print("\n  tokens Langfuse holds but does not price, by agent:")
    print(
        f"    {'agent':<26}{'input priced':>14}{'TOOL-USE':>12}{'output':>10}{'REASONING':>12}"
    )
    for agent, s in sorted(
        per_agent.items(), key=lambda kv: -kv[1].input_tool_use - kv[1].output_reasoning
    ):
        print(
            f"    {agent:<26}{s.input_priced:>14,}{s.input_tool_use:>12,}"
            f"{s.output_priced:>10,}{s.output_reasoning:>12,}"
        )

    # ---- reconcile against the bill ------------------------------------------------------
    if args.billing_csv:
        bill = load_billing(args.billing_csv)
        print(f"\n{'=' * 92}\nRECONCILIATION vs {args.billing_csv}\n{'=' * 92}")
        print(
            "  A Langfuse API key is project-scoped, but the bill covers the whole billing\n"
            "  account. A family with low coverage below is usage that lives in another Langfuse\n"
            "  project (or isn't traced at all) — not necessarily a mapping bug.\n"
        )
        print(
            f"  {'family':<26}{'GCP bill':>11}{'reconstructed':>15}{'coverage':>11}{'in $/Mtok':>12}"
        )

        reconstructed_total = 0.0
        low_coverage = []
        for name in sorted(set(bill.families) | set(per_family)):
            fam, split = bill.families.get(name), per_family.get(name)
            billed = fam.cost if fam else 0.0
            in_rate = fam.rate("input", "cached") if fam else 0.0
            recon = 0.0
            if fam and split:
                recon = split.input_total * in_rate + split.output_total * fam.rate(
                    "output"
                )
            reconstructed_total += recon
            coverage = recon / billed if billed else 0.0
            if billed > 0.5 and coverage < 0.8:
                low_coverage.append(name)
            print(
                f"  {name:<26}${billed:>10.3f}{('$%.3f' % recon):>15}"
                f"{('%.0f%%' % (coverage * 100)):>11}{in_rate * 1e6:>12.4f}"
            )

        authoritative = (
            bill.stated_total if bill.stated_total is not None else bill.line_item_total
        )
        pct = reconstructed_total / bill.chat * 100 if bill.chat else 0.0
        print(
            f"\n  GCP bill, per-token chat SKUs                   ${bill.chat:>10.3f}"
        )
        if bill.non_chat:
            print(
                f"  GCP bill, other SKUs (embeddings/grounding)      ${bill.non_chat:>10.3f}   [no Langfuse counterpart]"
            )
        if (
            bill.stated_total is not None
            and abs(bill.line_item_total - bill.stated_total) > 0.005
        ):
            print(
                f"  GCP stated 'Filtered total'                      ${bill.stated_total:>10.3f}"
                f"   [line items sum to ${bill.line_item_total:.3f}; GCP's own rounding]"
            )
        print(
            f"  reconstructed from tokens Langfuse holds         ${reconstructed_total:>10.3f}   ({pct:.0f}% of chat SKUs)"
        )
        print(f"  Langfuse actually reports                        ${reported:>10.3f}")
        print(
            f"  {'UNDER-REPORTED (this project vs whole account)':<46} ${authoritative - reported:>10.3f}"
        )
        if low_coverage:
            print(
                f"\n  Low coverage, expected if another project owns it: {', '.join(low_coverage)}"
            )
        if unpriced_models:
            print(
                f"  {unpriced_models:,} generations with no model were priced as '{args.fallback_family}' (--fallback-family)."
            )
        print(
            "\n  Cost is computed at ingestion and never backfilled, so fixing the mapping only\n"
            "  affects generations ingested afterwards. This window stays wrong."
        )

    # ---- thresholds ----------------------------------------------------------------------
    failures = []
    if (
        args.max_bucket_mismatch is not None
        and mismatches / n > args.max_bucket_mismatch
    ):
        failures.append(
            f"bucket mismatch {mismatches / n:.3f} > {args.max_bucket_mismatch}"
        )
    if (
        args.max_unpriced_models is not None
        and unpriced_models > args.max_unpriced_models
    ):
        failures.append(
            f"unpriced models {unpriced_models} > {args.max_unpriced_models}"
        )
    if failures:
        print("\nFAIL: " + "; ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
