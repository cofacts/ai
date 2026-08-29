"""Tests for `LangfuseTracingPlugin`'s usage mapping.

The plugin re-maps Gemini's `usage_metadata` onto the current Langfuse
generation because the OTel attributes
`openinference-instrumentation-google-adk` emits are a lossy projection of it,
and Langfuse prices usage keys by exact name — an unmatched key is silently
free. The reasoning, and the July/August billing reconciliation that sized the
gap, is in `docs/decisions/20260730-langfuse-usage-mapping.md`.

Two things are worth testing, and they need different setups:

* **The arithmetic** (`test_usage_mapping`) — that tool-use tokens land in
  `input`, that cached tokens are split out of `prompt` rather than added to it,
  that thinking tokens are spelled `output_reasoning`, and that a response with
  no usage writes nothing. A recording stub in place of the Langfuse client is
  enough, and lets us assert on the exact call.

* **Where the write lands** (`test_writes_onto_the_call_llm_span`) — the ADR
  flags this as an assumption that "must be verified during implementation, not
  assumed": `update_current_generation` targets whatever OTel span is current, so
  the whole fix depends on `after_model_callback` running inside the
  instrumentor's own `call_llm` span. That needs a real ADK run through a real
  instrumented tracer, in both streaming and non-streaming mode, since the
  difference between them is what causes the missing model names in the first
  place.
"""

import asyncio
from types import SimpleNamespace
from typing import Any, AsyncGenerator, Optional, cast
from unittest.mock import patch

import pytest
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.llm_agent import LlmAgent
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.apps.app import App
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types
from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from instrumentation import LangfuseTracingPlugin

MODEL = "gemini-3-flash-preview"


def usage(
    *,
    prompt_token_count: int = 0,
    cached_content_token_count: int = 0,
    tool_use_prompt_token_count: int = 0,
    candidates_token_count: int = 0,
    thoughts_token_count: int = 0,
    total_token_count: int = 0,
) -> types.GenerateContentResponseUsageMetadata:
    """The subset of `usage_metadata` the plugin reads."""
    return types.GenerateContentResponseUsageMetadata(
        prompt_token_count=prompt_token_count,
        cached_content_token_count=cached_content_token_count,
        tool_use_prompt_token_count=tool_use_prompt_token_count,
        candidates_token_count=candidates_token_count,
        thoughts_token_count=thoughts_token_count,
        total_token_count=total_token_count,
    )


def fake_context() -> CallbackContext:
    """The plugin's callbacks never touch the context — only the request/response."""
    return cast(CallbackContext, SimpleNamespace())


class Recorder:
    """Stands in for the Langfuse client, capturing update calls verbatim."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def update_current_generation(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)


async def run_plugin(
    responses: list[LlmResponse], request_model: Optional[str] = MODEL
) -> list[dict[str, Any]]:
    """Drives the callbacks over one turn's responses, as ADK would.

    Each turn runs in its own task so it gets its own copy of the context, the
    way concurrent sub-agents do — otherwise the model a previous turn stashed in
    the `ContextVar` would still be visible here.
    """
    return await asyncio.create_task(_run_plugin(responses, request_model))


async def _run_plugin(
    responses: list[LlmResponse], request_model: Optional[str]
) -> list[dict[str, Any]]:
    plugin = LangfuseTracingPlugin()
    recorder = Recorder()
    with patch("instrumentation.get_client", return_value=recorder):
        if request_model is not None:
            await plugin.before_model_callback(
                callback_context=fake_context(),
                llm_request=LlmRequest(model=request_model),
            )
        for response in responses:
            await plugin.after_model_callback(
                callback_context=fake_context(), llm_response=response
            )
    return recorder.calls


async def test_tool_use_tokens_are_folded_into_input():
    """`toolUsePromptTokenCount` is separate from `promptTokenCount` and billed at
    the input rate, so it belongs in `input`. On the instrumentor's own
    attributes it survives only inside `total`, which Langfuse cannot price.
    """
    (call,) = await run_plugin(
        [
            LlmResponse(
                usage_metadata=usage(
                    prompt_token_count=1287,
                    tool_use_prompt_token_count=2_943_390,
                    candidates_token_count=729,
                    thoughts_token_count=9963,
                    total_token_count=2_955_369,
                )
            )
        ]
    )

    assert call["usage_details"] == {
        "input": 1287 + 2_943_390,
        "input_cached_tokens": 0,
        "output": 729,
        "output_reasoning": 9963,
        "total": 2_955_369,
    }
    # The invariant `scripts/langfuse_check_usage.py` checks: the priced keys sum
    # to `total`, and `total` is Gemini's own count rather than a sum of ours.
    assert sum(v for k, v in call["usage_details"].items() if k != "total") == 2_955_369


async def test_cached_tokens_are_split_out_of_prompt():
    """`promptTokenCount` *includes* `cachedContentTokenCount`, so adding them
    would double-count. Splitting is also what earns the cache discount, which
    Langfuse otherwise charges at full input rate.
    """
    (call,) = await run_plugin(
        [
            LlmResponse(
                usage_metadata=usage(
                    prompt_token_count=10_000,
                    cached_content_token_count=8_000,
                    candidates_token_count=500,
                    total_token_count=10_500,
                )
            )
        ]
    )

    assert call["usage_details"] == {
        "input": 2_000,
        "input_cached_tokens": 8_000,
        "output": 500,
        "output_reasoning": 0,
        "total": 10_500,
    }
    assert sum(v for k, v in call["usage_details"].items() if k != "total") == 10_500


async def test_model_comes_from_the_request_then_the_response():
    """The request-side id is what the managed price definitions match.

    Vertex can answer with a dated build, and every managed Gemini definition
    from 2.5 onwards ends in a hard `$` — so a dated name matches nothing,
    resolves to no model and costs $0 for good, since cost is computed at
    ingestion. `model_version` stays the fallback for when the request side is
    unavailable; it is unset on ADK's aggregated streamed response anyway, which
    is the case that repairs the `model = null` generations.
    """
    (from_request,) = await run_plugin(
        [
            LlmResponse(
                model_version="gemini-3-flash-preview-11-2026",
                usage_metadata=usage(prompt_token_count=1, candidates_token_count=1),
            )
        ]
    )
    assert from_request["model"] == MODEL

    (from_response,) = await run_plugin(
        [
            LlmResponse(
                model_version="gemini-3-flash-preview-11-2026",
                usage_metadata=usage(prompt_token_count=1),
            )
        ],
        request_model=None,
    )
    assert from_response["model"] == "gemini-3-flash-preview-11-2026"


async def test_a_response_without_usage_writes_nothing():
    """In SSE mode this callback fires once per chunk and Gemini reports usage
    only at terminal points, so the guard is what makes it fire effectively once.
    """
    assert await run_plugin([LlmResponse(partial=True)]) == []


async def test_an_empty_aggregated_response_does_not_clobber_a_good_write():
    """`StreamingResponseAggregator.close()` can yield a response carrying no
    usage. Since `update_current_generation` overwrites, letting that through
    would replace a correct value with an empty one.
    """
    calls = await run_plugin(
        [
            LlmResponse(partial=True),
            LlmResponse(
                usage_metadata=usage(prompt_token_count=100, candidates_token_count=20)
            ),
            LlmResponse(partial=False),
        ]
    )

    assert len(calls) == 1
    assert calls[0]["usage_details"]["input"] == 100


class FakeLlm(BaseLlm):
    """Yields a scripted turn, so the run is deterministic and offline.

    Streaming is emulated the way ADK's own aggregator behaves: partial chunks
    carry no usage, and the terminal response carries usage but *no*
    `model_version` (`StreamingResponseAggregator.close()` omits it in both
    branches).
    """

    streaming: bool = False

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        answer = types.ModelContent(parts=[types.Part.from_text(text="ok")])
        if self.streaming:
            yield LlmResponse(content=answer, partial=True)
            yield LlmResponse(
                content=answer,
                usage_metadata=usage(
                    prompt_token_count=500,
                    cached_content_token_count=100,
                    tool_use_prompt_token_count=40_000,
                    candidates_token_count=30,
                    thoughts_token_count=70,
                    total_token_count=40_600,
                ),
                finish_reason=types.FinishReason.STOP,
            )
        else:
            yield LlmResponse(
                content=answer,
                model_version=MODEL,
                usage_metadata=usage(
                    prompt_token_count=500,
                    cached_content_token_count=100,
                    tool_use_prompt_token_count=40_000,
                    candidates_token_count=30,
                    thoughts_token_count=70,
                    total_token_count=40_600,
                ),
                finish_reason=types.FinishReason.STOP,
            )


@pytest.mark.parametrize("streaming", [False, True])
async def test_writes_onto_the_call_llm_span(streaming: bool):
    """The write must land on the instrumentor's `call_llm` span.

    `update_current_generation` writes to whatever span is current, so if
    `after_model_callback` ran outside that span the fix would silently create a
    second observation — or write nowhere — instead of repricing the generation.
    Both streaming modes are covered because the divergence between them is what
    strips model names from the streamed root agent's spans to begin with.
    """
    from openinference.instrumentation.google_adk import GoogleADKInstrumentor

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    # OTel refuses to replace an already-set global provider, and the
    # instrumentor reads the global one for the spans ADK creates itself.
    previous_provider = otel_trace._TRACER_PROVIDER
    otel_trace._TRACER_PROVIDER = None
    otel_trace.set_tracer_provider(provider)

    instrumentor = GoogleADKInstrumentor()
    instrumentor.instrument(tracer_provider=provider)
    try:
        agent = LlmAgent(name="writer", model=FakeLlm(model=MODEL, streaming=streaming))
        runner = InMemoryRunner(
            app=App(
                name="usage_mapping_test",
                root_agent=agent,
                plugins=[LangfuseTracingPlugin()],
            )
        )
        session = await runner.session_service.create_session(
            app_name=runner.app_name, user_id="u"
        )

        async for _ in runner.run_async(
            user_id="u",
            session_id=session.id,
            new_message=types.UserContent(parts=[types.Part.from_text(text="hi")]),
            run_config=RunConfig(
                streaming_mode=StreamingMode.SSE if streaming else StreamingMode.NONE
            ),
        ):
            pass
    finally:
        instrumentor.uninstrument()
        otel_trace._TRACER_PROVIDER = previous_provider

    call_llm = [s for s in exporter.get_finished_spans() if s.name == "call_llm"]
    assert len(call_llm) == 1, [s.name for s in exporter.get_finished_spans()]
    attributes = dict(call_llm[0].attributes or {})

    # Our write is on the same span the instrumentor put its token counts on.
    assert "llm.token_count.total" in attributes
    assert attributes["langfuse.observation.model.name"] == MODEL
    assert attributes["langfuse.observation.usage_details"] == (
        '{"input": 40400, "input_cached_tokens": 100, '
        '"output": 30, "output_reasoning": 70, "total": 40600}'
    )
