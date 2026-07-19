import json
import logging
import os
from typing import Optional, cast

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

# openinference semconv: "input.value" / "output.value" and their mime types.
# Langfuse shows the root span's input/output as the trace's input/output in
# session view.
_INPUT_VALUE_ATTR = SpanAttributes.INPUT_VALUE
_INPUT_MIME_ATTR = SpanAttributes.INPUT_MIME_TYPE
_OUTPUT_VALUE_ATTR = SpanAttributes.OUTPUT_VALUE
_OUTPUT_MIME_ATTR = SpanAttributes.OUTPUT_MIME_TYPE
_TEXT_MIME_TYPE = "text/plain"


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


def _parts_text(data: dict) -> Optional[str]:
    """
    Extracts joined text from an ADK message dict ({new_message|content}.parts).

    Returns None when the dict has no recognizable parts or no text parts, so
    callers keep the original attribute (e.g. tool-call payloads, image-only
    messages). Thought parts are skipped: the writer runs with
    include_thoughts=True, and thoughts are internal reasoning, not the
    reply text.
    """
    content = data.get("new_message") or data.get("content")
    if not isinstance(content, dict):
        return None
    parts = content.get("parts")
    if not isinstance(parts, list):
        return None
    texts = [
        text
        for part in parts
        if isinstance(part, dict)
        and not part.get("thought")
        and isinstance(text := part.get("text"), str)
        and text
    ]
    if not texts:
        return None
    return "\n".join(texts)


class TextExtractionSpanProcessor(SpanProcessor):
    """
    Rewrites input.value/output.value from serialized JSON to plain text so
    traces are browsable in Langfuse's session view (#14).

    GoogleADKInstrumentor stamps input.value with the serialized run_async
    arguments and output.value with the final Event JSON; Langfuse then shows
    raw JSON as the trace input/output. At on_end we parse those payloads and
    replace them with the joined text of new_message.parts/content.parts.

    on_end receives a ReadableSpan snapshot (no set_attribute), so we update
    the underlying attribute mapping directly. Only existing keys are ever
    replaced, never inserted or removed, and payloads without extractable
    text are left untouched.
    """

    def on_end(self, span) -> None:
        # Never let a rewrite failure break span end: the mapping is private
        # SDK API, and OTel does not catch processor exceptions. A raise here
        # would fail every span in the application.
        try:
            attributes = getattr(span, "_attributes", None)
            if not attributes:
                return
            for value_attr, mime_attr in (
                (_INPUT_VALUE_ATTR, _INPUT_MIME_ATTR),
                (_OUTPUT_VALUE_ATTR, _OUTPUT_MIME_ATTR),
            ):
                raw = attributes.get(value_attr)
                if not isinstance(raw, str):
                    continue
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                text = _parts_text(data)
                if text is None:
                    continue
                attributes[value_attr] = text
                if mime_attr in attributes:
                    attributes[mime_attr] = _TEXT_MIME_TYPE
        except Exception:
            logger.exception("Failed to rewrite span input/output text")


def _move_processor_first(provider: SDKTracerProvider, processor: SpanProcessor):
    """
    Moves `processor` ahead of previously registered span processors.

    Langfuse's BatchSpanProcessor is registered inside get_client(), before we
    can add ours, and processors run in registration order. Its on_end enqueues
    the span for asynchronous export, so the rewrite must run first or a batch
    flush can race it and export the raw JSON. The multi-processor has no
    public ordering API; on any surprise we leave the order unchanged, which
    degrades to that occasional race, not to an error.
    """
    try:
        multi = getattr(provider, "_active_span_processor", None)
        processors = getattr(multi, "_span_processors", None)
        if (
            multi is None
            or not isinstance(processors, tuple)
            or processor not in processors
        ):
            logger.warning("Could not reorder span processors; rewrite runs last.")
            return
        multi._span_processors = (
            processor,
            *(p for p in processors if p is not processor),
        )
    except Exception:
        logger.exception("Could not reorder span processors; rewrite runs last.")


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
        provider = cast(SDKTracerProvider, otel_trace.get_tracer_provider())
        provider.add_span_processor(RootSessionSpanProcessor())
        text_extraction = TextExtractionSpanProcessor()
        provider.add_span_processor(text_extraction)
        _move_processor_first(provider, text_extraction)
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
