import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from google.adk.cli.api_server import ApiServer
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.errors.session_not_found_error import SessionNotFoundError
from google.genai import types
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from cofacts_ai.auth_context import cofacts_token_var
from cofacts_ai.run_bus import RunBus, RunBusUnavailable
from instrumentation import setup_instrumentation

logger = logging.getLogger(__name__)

_agents_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_agents_dir, "cofacts_ai", ".env"))

# Must run before get_fast_api_app(): ADK claims the global OTel
# TracerProvider as part of building the app, and set_tracer_provider() is a
# no-op once a provider already exists. Calling this first lets Langfuse's
# provider (tagged with LANGFUSE_TRACING_ENVIRONMENT) win instead of ADK's
# bare one, which otherwise leaves every trace's environment as "default".
setup_instrumentation()

APP_NAME = "cofacts_ai"

_gcs_bucket = os.environ.get("GCS_ARTIFACT_BUCKET")
_redis_url = os.environ.get("REDIS_URL")

# Background runs (see cofacts_ai/run_bus.py). Without REDIS_URL the /runs
# routes answer 503 and the frontend falls back to ADK's /run_sse.
run_bus: RunBus | None = None


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    try:
        yield
    finally:
        if run_bus is not None:
            await run_bus.shutdown()
            await run_bus.redis.aclose()


app = get_fast_api_app(
    agents_dir=_agents_dir,
    session_service_uri=os.environ.get("DATABASE_URL"),
    artifact_service_uri=f"gs://{_gcs_bucket}" if _gcs_bucket else None,
    web=False,
    lifespan=_lifespan,
)


def _find_adk_server(fastapi_app: FastAPI) -> ApiServer:
    """The ApiServer behind get_fast_api_app(), which it doesn't expose.

    Background runs must use the same Runner as ADK's own routes: the same
    session and artifact services, plugins and agent. ADK's route handlers
    are closures over the server, so it is found through /run_sse's.
    test_main.py fails if an ADK upgrade moves it.
    """
    for route in fastapi_app.routes:
        if getattr(route, "path", None) != "/run_sse":
            continue
        for cell in getattr(route, "endpoint").__closure__ or ():
            if isinstance(cell.cell_contents, ApiServer):
                return cell.cell_contents
    raise RuntimeError("ADK's ApiServer not found behind /run_sse")


if _redis_url:
    from redis.asyncio import Redis

    _adk_server = _find_adk_server(app)
    run_bus = RunBus(
        redis=Redis.from_url(_redis_url, health_check_interval=30),
        app_name=APP_NAME,
        get_runner=lambda: _adk_server.get_runner_async(APP_NAME),
        session_service=_adk_server.session_service,
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


# ---- background runs ------------------------------------------------------
#
# Same path layout as ADK's session routes. Only the BFF reaches ADK, and it
# fills in user_id from the signed-in user, so a guessed session id alone
# can't reach someone else's run.

_SESSION_PATH = "/apps/{app_name}/users/{user_id}/sessions/{session_id}"


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StartRunRequest(_CamelModel):
    new_message: types.Content


class RunInfo(_CamelModel):
    invocation_id: str | None = None


class RunStatus(_CamelModel):
    running: bool
    invocation_id: str | None = None


class OpenedResult(_CamelModel):
    deferred: bool


def _bus(app_name: str) -> RunBus:
    if app_name != APP_NAME:
        raise HTTPException(status_code=404, detail="Unknown app")
    if run_bus is None:
        raise HTTPException(status_code=503, detail="Background runs are off")
    return run_bus


@app.post(
    _SESSION_PATH + "/runs",
    status_code=202,
    response_model=RunInfo,
    response_model_by_alias=True,
    responses={409: {"model": RunInfo}},
)
async def start_run(app_name: str, user_id: str, session_id: str, req: StartRunRequest):
    """Starts a run that keeps going when the caller disconnects.

    202 once the user's message is stored; 409 with the running invocation
    when the session already has a run (the caller attaches to that one).
    """
    bus = _bus(app_name)
    try:
        res = await bus.start(
            user_id=user_id, session_id=session_id, new_message=req.new_message
        )
    except RunBusUnavailable:
        raise HTTPException(status_code=503, detail="Shutting down")
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    info = RunInfo(invocation_id=res.invocation_id).model_dump(by_alias=True)
    if not res.started:
        return JSONResponse(info, status_code=409)
    return info


@app.get(
    _SESSION_PATH + "/runs/status",
    response_model=RunStatus,
    response_model_by_alias=True,
)
async def run_status(app_name: str, user_id: str, session_id: str):
    """Whether the session has a run going (read from the Redis lock)."""
    return RunStatus(**await _bus(app_name).status(user_id, session_id))


@app.get(_SESSION_PATH + "/runs/stream")
async def run_stream(app_name: str, user_id: str, session_id: str):
    """SSE of the run in progress: everything so far, then live events.

    The server closes the connection when the run ends; with no run going,
    right away.
    """
    bus = _bus(app_name)
    return StreamingResponse(
        bus.stream(user_id, session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@app.post(_SESSION_PATH + "/runs/cancel", status_code=202)
async def cancel_run(app_name: str, user_id: str, session_id: str):
    """Stops the session's run, wherever it runs.

    Viewers get the stopped message (customMetadata cofacts_run_end:
    cancelled), then the connection closes.
    """
    if not await _bus(app_name).cancel(user_id, session_id):
        raise HTTPException(status_code=404, detail="No run in progress")
    return {}


@app.post(
    _SESSION_PATH + "/opened",
    response_model=OpenedResult,
    response_model_by_alias=True,
)
async def session_opened(app_name: str, user_id: str, session_id: str):
    """Records lastOpenedAt, unless a run is going (that write would kill it).

    deferred: true means nothing was written; call again when the run ends.
    """
    try:
        deferred = await _bus(app_name).mark_opened(user_id, session_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Session not found")
    return OpenedResult(deferred=deferred)


class _Server(uvicorn.Server):
    """Interrupts background runs as soon as SIGTERM arrives.

    uvicorn waits for open connections to close before running the
    lifespan shutdown, and viewers' streams stay open until their run ends.
    So runs are stopped here instead, which in turn ends those streams.
    """

    def handle_exit(self, sig, frame):
        bus = run_bus
        if bus is not None and not self.should_exit:
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(lambda: loop.create_task(bus.shutdown()))
        super().handle_exit(sig, frame)


if __name__ == "__main__":
    _Server(
        uvicorn.Config(
            app,
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8000")),
            # Runs need ~ABORT_GRACE_SECONDS to seal; Docker and Cloud Run
            # both kill the container 10s after SIGTERM.
            timeout_graceful_shutdown=9,
        )
    ).run()
