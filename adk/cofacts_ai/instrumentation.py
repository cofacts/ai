import os
import logging
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from langfuse import get_client
from google.adk.plugins.base_plugin import BasePlugin
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events.event import Event

logger = logging.getLogger(__name__)

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
        logger.info("Langfuse instrumentation initialized.")
    else:
        logger.warning("Langfuse authentication failed. Skipping instrumentation.")


class LangfuseTracingPlugin(BasePlugin):
    """
    ADK Plugin that stamps each emitted event with the current Langfuse
    trace ID in custom_metadata, enabling the UI to submit user feedback
    (thumbs up/down) against the correct Langfuse trace.
    """

    def __init__(self):
        super().__init__(name="langfuse_tracing")

    async def on_event_callback(
        self, *, invocation_context: InvocationContext, event: Event
    ):
        langfuse = get_client()
        trace_id = langfuse.get_current_trace_id()
        if trace_id:
            if event.custom_metadata is None:
                event.custom_metadata = {}
            event.custom_metadata["langfuse_trace_id"] = trace_id
        return event
