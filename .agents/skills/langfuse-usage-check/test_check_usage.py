"""Tests for the standing check in `check_usage.py`, next to this file.

The check is what tells us the usage mapping is still working on live data, so
its own blind spots are worth pinning down: it has to count a token as free both
when the bucket arrived under a key Langfuse could not price and when the bucket
never arrived at all. Summing every key as if it were priced satisfies the first
case by accident and would report success while Google bills us — which is the
shape of cause 3 in `docs/decisions/20260730-langfuse-usage-mapping.md`.
"""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "check_usage", Path(__file__).resolve().parent / "check_usage.py"
)
assert _spec and _spec.loader
check_usage = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_usage)
unpriced_tokens = check_usage.unpriced_tokens


def test_the_fixed_path_reports_nothing_unpriced():
    """What the plugin writes today: four buckets, each priced, plus Gemini's own
    total."""
    usage = {
        "input": 40_400,
        "input_cached_tokens": 100,
        "output": 30,
        "output_reasoning": 70,
        "total": 40_600,
    }
    costs = {
        "input": 0.0202,
        "input_cached_tokens": 0.000005,
        "output": 0.00009,
        "output_reasoning": 0.00021,
        "total": 0.0203,
    }
    assert unpriced_tokens(usage, costs) == 0


def test_a_key_langfuse_could_not_price_counts_as_unpriced():
    """Cause 3: `completion_details.reasoning` is well-formed and sums to `total`,
    but no managed Gemini definition prices it, so `costDetails` omits it."""
    usage = {
        "input": 2_944_677,
        "output": 729,
        "completion_details.reasoning": 9_963,
        "total": 2_955_369,
    }
    costs = {"input": 1.472, "output": 0.002, "total": 1.474}
    assert unpriced_tokens(usage, costs) == 9_963


def test_a_bucket_that_never_arrived_counts_as_unpriced():
    """Cause 1: tool-use tokens reach Langfuse only inside `total`."""
    usage = {"input": 1_287, "output": 729, "total": 2_955_369}
    costs = {"input": 0.0006, "output": 0.002, "total": 0.0026}
    assert unpriced_tokens(usage, costs) == 2_955_369 - 1_287 - 729


def test_an_unresolved_model_makes_every_token_unpriced():
    """Cause 2: no model name resolves, so nothing is priced and `costDetails`
    comes back empty — every token in the generation was given away."""
    usage = {"input": 37_502, "output": 2_375, "total": 39_877}
    assert unpriced_tokens(usage, {}) == 39_877


def test_both_kinds_of_loss_add_up():
    usage = {
        "input": 1_287,
        "completion_details.reasoning": 9_963,
        "output": 729,
        "total": 2_955_369,
    }
    costs = {"input": 0.0006, "output": 0.002, "total": 0.0026}
    never_sent = 2_955_369 - 1_287 - 9_963 - 729
    assert unpriced_tokens(usage, costs) == 9_963 + never_sent
