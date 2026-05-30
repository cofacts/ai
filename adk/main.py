import os

import uvicorn
from fastapi import Request
from google.adk.cli.fast_api import get_fast_api_app

from cofacts_ai.auth_context import cofacts_token_var

_agents_dir = os.path.dirname(os.path.abspath(__file__))

app = get_fast_api_app(
    agents_dir=_agents_dir,
    session_service_uri=os.environ.get(
        "DATABASE_URL", "sqlite+aiosqlite:////tmp/sessions.db"
    ),
    web=False,
)


@app.middleware("http")
async def _inject_cofacts_token(request: Request, call_next):
    auth = request.headers.get("authorization", "")
    token = auth.removeprefix("Bearer ").strip() or None
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
