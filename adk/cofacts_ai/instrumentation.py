import logging
import os
from typing import cast

from google.adk.agents.invocation_context import InvocationContext
from google.adk.plugins.base_plugin import BasePlugin
from langfuse import get_client
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from openinference.semconv.trace import SpanAttributes
from opentelemetry import trace as otel_trace
from opentelemetry.sdk.trace import SpanProcessor
from opentelemetry.sdk.trace import TracerProvider as SDKTracerProvider

logger = logging.getLogger(__name__)

_SESSION_ID_ATTR = SpanAttributes.SESSION_ID
_LANGFUSE_TRACE_ID_KEY = "langfuse_trace_id"


class RootSessionSpanProcessor(SpanProcessor):
    """
    Ensures all spans in an OTel trace share the root span's session.id.

    Google ADK spawns a new session per sub-agent invocation, causing
    openinference to stamp sub-agent spans with a different session.id.
    Langfuse's last-write-wins OTLP ingestion then assigns the trace to the
    wrong session. This processor overwrites every child span's session.id
    with the root span's value before the span is exported.
    """

    def __init__(self):
        self._root_sessions: dict[int, str] = {}

    def on_start(self, span, parent_context=None):
        session_id = (span.attributes or {}).get(_SESSION_ID_ATTR)
        if not isinstance(session_id, str):
            return

        span_ctx = span.get_span_context()
        if span_ctx is None:
            return
        trace_id = span_ctx.trace_id

        # span.parent is the authoritative OTel parent SpanContext (set during
        # span creation). parent_context is the ambient context at call time and
        # may not reflect the actual parent when openinference detaches context.
        is_root = span.parent is None or not span.parent.is_valid
        if is_root:
            # Root or context-detached span: register the first session seen per
            # trace. setdefault is atomic under the GIL.
            root = self._root_sessions.setdefault(trace_id, session_id)
            if root != session_id:
                span.set_attribute(_SESSION_ID_ATTR, root)
            return

        root = self._root_sessions.get(trace_id)
        if root and session_id != root:
            span.set_attribute(_SESSION_ID_ATTR, root)

    def on_end(self, span):
        if span.parent is None and span.context is not None:
            self._root_sessions.pop(span.context.trace_id, None)


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
