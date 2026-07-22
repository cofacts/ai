import os

import uvicorn
from dotenv import load_dotenv
from fastapi import Request
from google.adk.cli.fast_api import get_fast_api_app

from cofacts_ai.auth_context import cofacts_token_var
from cofacts_ai.instrumentation import setup_instrumentation

_agents_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_agents_dir, "cofacts_ai", ".env"))

# Must run before get_fast_api_app(): ADK claims the global OTel
# TracerProvider as part of building the app, and set_tracer_provider() is a
# no-op once a provider already exists. Calling this first lets Langfuse's
# provider (tagged with LANGFUSE_TRACING_ENVIRONMENT) win instead of ADK's
# bare one, which otherwise leaves every trace's environment as "default".
setup_instrumentation()

_gcs_bucket = os.environ.get("GCS_ARTIFACT_BUCKET")

app = get_fast_api_app(
    agents_dir=_agents_dir,
    session_service_uri=os.environ.get("DATABASE_URL"),
    artifact_service_uri=f"gs://{_gcs_bucket}" if _gcs_bucket else None,
    web=False,
)


@app.middleware("http")
async def _inject_cofacts_token(request: Request, call_next):
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() or None if auth.lower().startswith("bearer ") else None
    t = cofacts_token_var.set(token)
    try:
        return await call_next(request)
    finally:
        cofacts_token_var.reset(t)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
    )
