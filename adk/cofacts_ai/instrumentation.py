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
from opentelemetry.trace import get_current_span

logger = logging.getLogger(__name__)

# openinference semconv: "session.id"
_SESSION_ID_ATTR = SpanAttributes.SESSION_ID
# Langfuse-specific attribute that takes precedence over session.id in OTLP ingestion
_LANGFUSE_SESSION_ID_ATTR = "langfuse.session.id"
# Key used in event.custom_metadata to link events back to their Langfuse trace
_LANGFUSE_TRACE_ID_KEY = "langfuse_trace_id"


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
        session = (
            parent_attrs.get(_LANGFUSE_SESSION_ID_ATTR)
            or parent_attrs.get(_SESSION_ID_ATTR)
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
