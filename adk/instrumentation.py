import contextvars
import logging
import os
from typing import Optional, cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.invocation_context import InvocationContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.plugins.base_plugin import BasePlugin
from langfuse import get_client
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from openinference.semconv.trace import SpanAttributes
from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import SpanProcessor
from opentelemetry.sdk.trace import TracerProvider as SDKTracerProvider
from opentelemetry.trace import get_current_span

logger = logging.getLogger(__name__)

# openinference semconv: "session.id"
_SESSION_ID_ATTR = SpanAttributes.SESSION_ID
# Langfuse-specific attribute that takes precedence over session.id in OTLP ingestion
_LANGFUSE_SESSION_ID_ATTR = "langfuse.session.id"
# Key used in event.custom_metadata to link events back to their Langfuse trace
_LANGFUSE_TRACE_ID_KEY = "langfuse_trace_id"

# Model id of the LLM call in flight. `after_model_callback` receives only the
# response, and the aggregated response ADK builds at the end of a streamed turn
# leaves `model_version` unset (`utils/streaming_utils.py`, both branches of
# `StreamingResponseAggregator.close()`), so the request side has to be carried
# forward. ADK runs both callbacks from the same coroutine, and sub-agents that
# run concurrently do so in separate tasks, each with its own context copy — so
# a ContextVar keeps concurrent agents from reading each other's model.
_request_model: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "cofacts_langfuse_request_model", default=None
)


class RootSessionSpanProcessor(SpanProcessor):
    """
    Stamps langfuse.session.id on every span by propagating from the parent.

    GoogleADKInstrumentor incorrectly stamps sub-agent spans with ADK-internal
    session UUIDs (https://github.com/Arize-ai/openinference/issues/3117).
    Langfuse gives langfuse.session.id precedence over session.id, so we read
    the parent span's session at on_start time and copy it down — non-destructively
    and without maintaining any state.
    """

    def on_start(self, span, parent_context=None):
        parent = get_current_span(parent_context)
        parent_attrs = getattr(parent, "attributes", None) or {}

        # Prefer langfuse.session.id (already corrected) over session.id (may be wrong)
        session = parent_attrs.get(_LANGFUSE_SESSION_ID_ATTR) or parent_attrs.get(
            _SESSION_ID_ATTR
        )

        if session is None:
            # No parent session — fall back to own session.id (root span)
            own = (span.attributes or {}).get(_SESSION_ID_ATTR)
            if isinstance(own, str):
                session = own

        if isinstance(session, str):
            span.set_attribute(_LANGFUSE_SESSION_ID_ATTR, session)


def setup_instrumentation():
    """
    Sets up Langfuse instrumentation for Google ADK.
    """
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        logger.warning("Langfuse credentials not found. Skipping instrumentation.")
        return

    langfuse = get_client()

    if langfuse.auth_check():
        GoogleADKInstrumentor().instrument()
        cast(SDKTracerProvider, otel_trace.get_tracer_provider()).add_span_processor(
            RootSessionSpanProcessor()
        )
        logger.info("Langfuse instrumentation initialized.")
    else:
        logger.warning("Langfuse authentication failed. Skipping instrumentation.")


class LangfuseTracingPlugin(BasePlugin):
    """
    ADK Plugin that stamps each emitted event with the current Langfuse
    trace ID in custom_metadata.

    We use `before_run_callback` and `run_config.custom_metadata` because:
    1. ADK's `Runner` merges `run_config.custom_metadata` into every event
       generated during the invocation.
    2. This merging happens *before* the event is persisted to the session
       store.
    3. Using `on_event_callback` would be too late for persistence, as ADK
       saves the event to the database before the plugin's `on_event` is called.
    """

    def __init__(self):
        super().__init__(name="langfuse_tracing")

    async def before_run_callback(self, *, invocation_context: InvocationContext):
        langfuse = get_client()
        trace_id = langfuse.get_current_trace_id()
        if trace_id and invocation_context.run_config is not None:
            # Set the trace ID in run_config so ADK automatically stamps all
            # future events in this invocation before they are saved to the DB.
            if invocation_context.run_config.custom_metadata is None:
                invocation_context.run_config.custom_metadata = {}
            invocation_context.run_config.custom_metadata[_LANGFUSE_TRACE_ID_KEY] = (
                trace_id
            )

    async def before_model_callback(
        self, *, callback_context: CallbackContext, llm_request: LlmRequest
    ) -> None:
        """Records the model id so `after_model_callback` can price the call.

        Runs outside the `call_llm` span (ADK invokes it before entering the
        tracing context, `base_llm_flow.py`), so this only stashes — it cannot
        write to the observation itself.
        """
        _request_model.set(llm_request.model)
        return None

    async def after_model_callback(
        self, *, callback_context: CallbackContext, llm_response: LlmResponse
    ) -> None:
        """Maps `usage_metadata` onto the current generation ourselves.

        The OTel attribute set `openinference-instrumentation-google-adk` emits
        is a lossy projection of `usage_metadata`, and Langfuse prices usage keys
        by exact name — an unmatched key is silently free rather than an error.
        Three of those losses cost real money (see
        `docs/decisions/20260730-langfuse-usage-mapping.md`):

        * `tool_use_prompt_token_count` reaches Langfuse only inside `total`,
          which is a derived aggregate and not priceable. Google bills it at the
          plain input rate, so it is folded into `input` here. (Fixed upstream in
          0.1.18 too, but we compute `input` ourselves regardless — see below.)
        * `thoughts_token_count` arrives as `completion_details.reasoning`, which
          no managed Gemini definition prices. `output_reasoning` is the spelling
          that carries a price.
        * `cached_content_token_count` is never emitted at all, so cached tokens
          are charged at full rate instead of their 90% discount.

        This *overwrites* `usage_details` rather than adding to it, which is what
        keeps it correct across instrumentor upgrades: whatever the instrumentor
        sent is replaced wholesale by the authoritative `google-genai` numbers.
        The same property is why `input` must still be computed in full here —
        an upgrade that folds tool-use into `prompt` does not help us, because
        that folded value also includes the cached tokens we need to split out.

        `total` is sent explicitly for the same reason. Langfuse derives it as the
        sum of the keys it received when none is ingested, and a total derived
        from our own buckets cannot contradict them: the shortfall
        `scripts/langfuse_check_usage.py` watches would be 0 by construction, and
        a bucket we later drop or misspell would vanish from the yardstick along
        with the tokens. `total_token_count` comes from Gemini, so it stays an
        independent reference.

        Written via `langfuse.observation.*` attributes, which Langfuse's
        ingestion gives precedence over the generic OTel ones, so this lands on
        the instrumentor's own `call_llm` span rather than creating a second
        observation.
        """
        usage = llm_response.usage_metadata
        if usage is None:
            # Load-bearing, not defensive. In SSE mode this callback fires once
            # per chunk and Gemini reports usage only at terminal points, so this
            # is what makes it effectively fire once. It also protects a good
            # value from being clobbered: `close()` can return an aggregated
            # response with no usage, and leaving the last usage-bearing write in
            # place is the right outcome there.
            return None

        prompt = usage.prompt_token_count or 0
        # `prompt_token_count` *includes* `cached_content_token_count`, so the two
        # are split rather than added, or cached tokens get counted twice.
        cached = usage.cached_content_token_count or 0

        usage_details = {
            "input": prompt - cached + (usage.tool_use_prompt_token_count or 0),
            "input_cached_tokens": cached,
            "output": usage.candidates_token_count or 0,
            "output_reasoning": usage.thoughts_token_count or 0,
        }
        if usage.total_token_count is not None:
            usage_details["total"] = usage.total_token_count

        get_client().update_current_generation(
            # The request side is preferred over `model_version` because Vertex
            # can answer with a dated build (`gemini-3-flash-preview-11-2026`)
            # while the managed price definitions on our instance match the
            # undated id exactly: every Gemini definition from 2.5 onwards ends
            # in a hard `$`, and the optional group the older ones carry is
            # Vertex's `@version` form, not a date suffix. An unmatched name
            # resolves to no model and costs $0, permanently, since cost is
            # computed at ingestion. `model_version` remains the fallback for
            # the case the request side cannot cover.
            model=_request_model.get() or llm_response.model_version,
            usage_details=usage_details,
        )
        return None
