import os
import logging

try:
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from openinference.instrumentation.google_adk import GoogleADKInstrumentor
    from langfuse.opentelemetry import LangfuseExporter
except ImportError:
    # This handles the case where dependencies might not be installed in the environment checking this file
    TracerProvider = None
    BatchSpanProcessor = None
    GoogleADKInstrumentor = None
    LangfuseExporter = None

logger = logging.getLogger(__name__)

def setup_instrumentation():
    """
    Sets up Langfuse instrumentation for Google ADK if credentials are provided.
    """
    if not GoogleADKInstrumentor or not LangfuseExporter:
        logger.warning("Instrumentation packages not found. Skipping Langfuse setup.")
        return

    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    if not public_key or not secret_key:
        logger.warning(
            "Langfuse credentials (LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY) not found. "
            "Skipping Langfuse instrumentation."
        )
        return

    try:
        logger.info(f"Initializing Langfuse instrumentation (host: {host})...")

        trace_provider = TracerProvider()

        # Initialize Langfuse exporter
        exporter = LangfuseExporter(
            public_key=public_key,
            secret_key=secret_key,
            host=host
        )

        # Use BatchSpanProcessor for better performance in production
        trace_provider.add_span_processor(BatchSpanProcessor(exporter))

        # Instrument Google ADK
        # Note: explicit tracer_provider might be needed if not setting global
        GoogleADKInstrumentor().instrument(tracer_provider=trace_provider)

        logger.info("Langfuse instrumentation set up successfully.")

    except Exception as e:
        logger.error(f"Failed to set up Langfuse instrumentation: {e}", exc_info=True)
