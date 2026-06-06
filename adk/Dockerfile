# --- builder ---
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .

# --- runtime ---
FROM python:3.12-slim-bookworm
WORKDIR /app
COPY --from=builder /app /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
ENV DATABASE_URL=sqlite+aiosqlite:////tmp/sessions.db
# When GCS_ARTIFACT_BUCKET is set (deployed envs, alongside a Postgres
# DATABASE_URL), artifacts are persisted to GCS instead of the default
# in-memory store; left unset for local dev, where in-memory is fine.
CMD exec adk api_server --port 8000 --host 0.0.0.0 \
    --session_service_uri=$DATABASE_URL \
    ${GCS_ARTIFACT_BUCKET:+--artifact_service_uri=gs://$GCS_ARTIFACT_BUCKET} .
