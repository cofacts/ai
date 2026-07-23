---
status: 'accepted'
date: 2026-05-06
decision-makers: [MrOrz]
consulted:
informed:
---

# Persist ADK chat sessions in a database (SQLite locally, PostgreSQL via Cloud SQL proxy in production)

## Context and Problem Statement

The Google-ADK backend (`adk/cofacts_ai/`) served every chat session from ADK's
`InMemorySessionService`. Because the backend runs as one container in a Cloud Run service
that scales to zero and is redeployed on each release, all session state — conversation
history and session titles — was held only in process memory and was lost on every container
restart, redeploy, or autoscaling event. Users returning to the app found their conversations
gone.

Scope: the ADK backend's session storage layer and the Cloud Run deployment topology (a new
sidecar container plus the `DATABASE_URL` wiring); the frontend/BFF are unaffected.

Driving PR: [cofacts/ai#33](https://github.com/cofacts/ai/pull/33).

## Decision Drivers

- Chat sessions must survive container restarts, redeploys, and scale-to-zero.
- Session titles must persist across page reloads.
- Local development must keep working with no external database and no extra credentials.
- Production must connect to a managed database securely, without embedding a password in the
  service configuration.
- Reuse the existing Cloud SQL instance rather than standing up new database infrastructure.

## Considered Options

- **In-memory (`InMemorySessionService`, status quo)** — no persistence.
- **SQLite only** — a file-backed `DatabaseSessionService` everywhere.
- **PostgreSQL via a Cloud SQL Auth Proxy sidecar** — SQLite locally, PostgreSQL in
  deployed environments, reached through an in-pod proxy container.
- **Managed PostgreSQL with a direct connection** — the backend opens a direct, password- or
  TLS-authenticated connection to Cloud SQL.

## Decision Outcome

Chosen option: **PostgreSQL via a Cloud SQL Auth Proxy sidecar**, because it persists sessions
across restarts while keeping local development on a zero-dependency SQLite file and letting
production authenticate to Cloud SQL by service-account identity (IAM) rather than a stored
password.

Concretely, as shipped in PR #33:

1. **`InMemorySessionService` → `DatabaseSessionService`.** `main.py` builds the FastAPI app
   with `session_service_uri=os.environ.get("DATABASE_URL")`, so ADK backs sessions with a
   SQLAlchemy engine keyed off that URL. New Python deps: `aiosqlite`, `sqlalchemy`,
   `asyncpg`.
2. **SQLite locally.** The backend `Dockerfile` sets a default
   `ENV DATABASE_URL=sqlite+aiosqlite:////tmp/sessions.db`; `adk/cofacts_ai/.env.example`
   leaves `DATABASE_URL` empty and documents that it falls back to SQLite for local dev
   (ADK auto-creates `adk/cofacts_ai/.adk/session.db` under `adk web`). Driver: `aiosqlite`.
3. **PostgreSQL in production/preview.** Cloud Run overrides `DATABASE_URL` with a
   `postgresql+asyncpg://SA_EMAIL%40PROJECT.iam@localhost/adk` URL (driver: `asyncpg`),
   pointing at `localhost` where the proxy listens.
4. **`cloudsql-proxy` sidecar.** `service.template.yaml` adds a
   `gcr.io/cloud-sql-connectors/cloud-sql-proxy:2` container that dials the
   `${GC_PROJECT_ID}:asia-east1:cofacts` instance and listens on `0.0.0.0:5432` with
   `--auto-iam-authn`, so no database password is needed — the Cloud Run service account
   authenticates via IAM. The `backend` container declares a dependency on `cloudsql-proxy`
   (`run.googleapis.com/container-dependencies: {"ingress":["backend"],"backend":["cloudsql-proxy"]}`),
   so the proxy is healthy before the backend starts.

Deploy-time setup this requires (per the PR): create an `adk` database on the existing Cloud
SQL instance; grant the runtime service account `CREATE`/`USAGE` on the `public` schema; set
`DATABASE_URL` in the CD environment; and grant the deployer SA
(`rumors-site-deployment@...`) `roles/iam.serviceAccountUser` on the runtime SA.

### Consequences

- Good, because chat sessions and session titles now survive container restarts, redeploys,
  and scale-to-zero (the exact behavior the PR test plan verified).
- Good, because production uses IAM (`auto-iam-authn`) instead of a stored database password,
  and the proxy terminates the secure connection to Cloud SQL inside the pod.
- Good, because local development keeps a zero-setup SQLite file — same `DatabaseSessionService`
  code path, no proxy, no credentials.
- Good, because it reuses the existing Cloud SQL instance rather than provisioning new
  infrastructure.
- Bad, because the deployment now carries a third container and a startup ordering constraint;
  a failed/slow proxy blocks the backend from starting.
- Bad, because it adds operational prerequisites (database creation, schema grants, IAM role
  bindings) that must be done before a deploy will succeed.

## Confirmation

Verified via the PR #33 test plan: locally, `uv run adk web .` starts and creates
`adk/cofacts_ai/.adk/session.db`, and sessions survive an ADK backend restart that previously
lost them; on staging, the backend starts up with a healthy `cloudsql-proxy` sidecar and
session titles persist across page reload. Ongoing confirmation is the container-dependency
health gate plus the sidecar's TCP startup probe on port 5432 in `service.template.yaml`.

## More Information

- Implemented in [cofacts/ai#33](https://github.com/cofacts/ai/pull/33) (merged 2026-05-06),
  stacked on #32.
- The multi-container Cloud Run topology this sidecar plugs into is covered by
  [`20260303-cloud-run-multi-container-deploy`](20260303-cloud-run-multi-container-deploy.md).
