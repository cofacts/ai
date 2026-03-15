import os
import logging
import json
from typing import Any, Optional
from opentelemetry import trace
from opentelemetry.sdk.trace import SpanProcessor, ReadableSpan, Span
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from langfuse import get_client

logger = logging.getLogger(__name__)

class TextExtractionSpanProcessor(SpanProcessor):
    """
    Custom SpanProcessor to extract text for trace input & output
    for easier browsing in session view.
    """
    def on_end(self, span: ReadableSpan) -> None:
        # Note: on_end receives a ReadableSpan. To set attributes,
        # we can't directly use Span methods if it's already ended,
        # but the processor is allowed to modify the span before it's exported.
        # In most SDK implementations, we can still cast and set attributes.

        attributes = dict(span.attributes) if span.attributes else {}
        if not attributes:
            return

        modified = False

        # Extract input text
        input_value = attributes.get("input.value")
        if input_value and isinstance(input_value, str):
            try:
                data = json.loads(input_value)
                text = self._extract_text_from_data(data)
                if text:
                    span.set_attribute("input.value", text)
                    modified = True
            except json.JSONDecodeError:
                pass

        # Extract output text
        output_value = attributes.get("output.value")
        if output_value and isinstance(output_value, str):
            try:
                data = json.loads(output_value)
                text = self._extract_text_from_data(data)
                if text:
                    span.set_attribute("output.value", text)
                    modified = True
            except json.JSONDecodeError:
                pass

    def _extract_text_from_data(self, data: Any) -> Optional[str]:
        """
        Helper to extract text from ADK message structures.
        Supports new_message, content, and parts.
        """
        parts = []

        # Check for different possible structures in Google ADK / Gemini responses
        if isinstance(data, dict):
            # new_message.parts or content.parts
            content = data.get("new_message") or data.get("content")
            if isinstance(content, dict):
                parts_data = content.get("parts", [])
            elif isinstance(data.get("parts"), list):
                parts_data = data.get("parts", [])
            else:
                parts_data = []

            if isinstance(parts_data, list):
                for part in parts_data:
                    if isinstance(part, dict) and "text" in part:
                        parts.append(str(part["text"]))
                    elif isinstance(part, str):
                        parts.append(part)

        if parts:
            return " ".join(parts)
        return None

def setup_instrumentation():
    """
    Sets up Langfuse instrumentation for Google ADK.
    """
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        logger.warning("Langfuse credentials not found. Skipping instrumentation.")
        return

    langfuse = get_client()

    if langfuse.auth_check():
        # Register custom text extraction processor
        trace.get_tracer_provider().add_span_processor(TextExtractionSpanProcessor())

        GoogleADKInstrumentor().instrument()
        logger.info("Langfuse instrumentation initialized with custom text extraction.")
    else:
        logger.warning("Langfuse authentication failed. Skipping instrumentation.")
