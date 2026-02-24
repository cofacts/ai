import os
import logging
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from langfuse import get_client

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
