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
CMD ["sh", "-c", "exec adk api_server --port 8000 --host 0.0.0.0 ${DATABASE_URL:+--session_service_uri=$DATABASE_URL} ."]
