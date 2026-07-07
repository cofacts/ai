import os

# cofacts_ai.agent calls load_dotenv() then setup_instrumentation() at module
# import time. setup_instrumentation() performs a real Langfuse auth_check()
# network call whenever both LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are
# set. load_dotenv() defaults to override=False, so pre-setting these to
# empty strings here (before any test module imports cofacts_ai.agent) makes
# it skip instrumentation regardless of what's in cofacts_ai/.env.
os.environ.setdefault("LANGFUSE_PUBLIC_KEY", "")
os.environ.setdefault("LANGFUSE_SECRET_KEY", "")
