import os
import logging
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from langfuse.opentelemetry import LangfuseExporter

logger = logging.getLogger(__name__)

def setup_instrumentation():
    """
    Sets up Langfuse instrumentation for Google ADK.
    """
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        logger.warning("Langfuse credentials not found. Skipping instrumentation.")
        return

    # Set up the tracer provider
    trace_provider = TracerProvider()

    # Configure Langfuse exporter
    # It automatically picks up LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST from env
    exporter = LangfuseExporter()

    # Add the exporter to the tracer provider
    trace_provider.add_span_processor(BatchSpanProcessor(exporter))

    # Register the tracer provider globally
    trace.set_tracer_provider(trace_provider)

    # Instrument Google ADK
    GoogleADKInstrumentor().instrument()

    logger.info("Langfuse instrumentation initialized.")
