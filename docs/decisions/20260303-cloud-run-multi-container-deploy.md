---
status: 'accepted'
date: 2026-03-03
decision-makers: [MrOrz]
consulted:
informed:
---

# Deploy as a single multi-container Cloud Run service with per-PR preview revisions

## Context and Problem Statement

Cofacts.ai ships as two runtimes that must run together: a Node "ingress" container (the
TanStack Start frontend + BFF) and a Python Google-ADK backend. They need low-latency
communication, a shared release lifecycle, and a hosting model where every pull request can
be reviewed as a live, production-identical preview without disturbing production traffic —
and where CI can authenticate to Google Cloud without long-lived credentials. This record
covers the founding deployment architecture introduced in
[cofacts/ai#10](https://github.com/cofacts/ai/pull/10). Scope: the `ingress` frontend/BFF
container, the ADK backend container, and the deploy/cleanup workflows (no application code).

## Decision Drivers

- The frontend/BFF and the ADK backend must be deployed and versioned as one unit and talk to
  each other with minimal latency.
- Keep infrastructure minimal and cheap to run — one service to manage, able to scale to zero.
- Every PR needs an isolated, reviewable preview at its own URL, with zero impact on the
  revision serving production traffic.
- CI must authenticate to GCP without storing exported service-account JSON keys as secrets.
- The service definition should be declarative and reproducible across environments.

## Considered Options

- **Single Cloud Run service with multiple containers** — an `ingress` container plus an ADK
  backend sidecar in the same revision, communicating over `localhost`.
- Two separate Cloud Run services (one per component) calling each other over the network.
- One container image bundling both the Node and Python runtimes.
- For previews: **a 0%-traffic tagged revision on the same service** vs. a separate ephemeral
  service per PR.
- For CI auth: **Workload Identity Federation** vs. an exported service-account JSON key.

## Decision Outcome

Chosen option: a **single multi-container Cloud Run service** (`cofacts-ai`, region
`asia-east1`) with the ADK backend as a sidecar, because it lets the two runtimes share one
revision and lifecycle and talk over `localhost` with no cross-service network hop, while a
tagged-revision preview model gives each PR an isolated URL on the same service.

As originally shipped in #10 (two containers):

1. **Containers** — `ingress` (Node frontend/BFF, `containerPort` 3000) and `backend` (Python
   ADK, listening on port 8000). The ingress reaches the sidecar via `ADK_URL=http://localhost:8000`;
   a `run.googleapis.com/container-dependencies` annotation orders startup so `ingress` starts
   only after `backend`.
2. **Images** — built and pushed to Artifact Registry as
   `asia-east1-docker.pkg.dev/<project>/cofacts-ai/frontend` and `.../backend`, tagged with the
   commit SHA. `service.template.yaml` is rendered to `service.yaml` via `envsubst` and applied
   with `gcloud run services replace`.
3. **CI auth** — GitHub Actions authenticates to GCP with Workload Identity Federation
   (`google-github-actions/auth@v2` using a `workload_identity_provider` + `service_account`), so
   no long-lived key material is stored.
4. **Traffic model** — a push to `master` sends 100% traffic to the new revision while
   preserving all existing tags at 0%. A PR (opened/synchronize) deploys the new revision at
   **0% traffic** tagged `pr-<n>`, leaving the current 100% revision serving; a transient GitHub
   Deployment (environment `pr-<n>`) is created and its status updated with the preview URL.
5. **Cleanup** — on PR close, `preview-cleanup.yml` runs `gcloud run services update-traffic
--remove-tags=pr-<n>` and deactivates/deletes the PR's GitHub Deployments.

This established the multi-container/sidecar + preview model that later PRs amend (a third
`cloudsql-proxy` sidecar was added afterwards — see More Information).

### Consequences

- Good, because the two runtimes ship as one revision and communicate over `localhost`, with no
  separate service, ingress, or network path to secure between them.
- Good, because the single service can scale to zero (`minScale: 0`), keeping idle cost low.
- Good, because each PR gets an isolated, production-identical preview at its own tagged URL
  without touching live traffic, and it is torn down automatically on close.
- Good, because Workload Identity Federation removes long-lived service-account keys from CI
  secrets, and `service.template.yaml` is a single declarative source rendered per environment.
- Bad, because all containers share one revision's scaling and lifecycle — the frontend and
  backend cannot scale independently, and changing either rebuilds and redeploys the whole
  service.
- Bad, because preview revisions and tags accumulate on the one service and must be cleaned up,
  and the workflow's traffic-block bookkeeping (preserving existing tags via `jq`) is intricate.

## Confirmation

The `Deploy` workflow (`.github/workflows/deploy.yml`) is the enforcement point: on every push
to `master` and on PR open/synchronize it builds and pushes both images, renders `service.yaml`,
and runs `gcloud run services replace`. A PR preview only reports success once its `pr-<n>`
revision deploys and the GitHub Deployment status flips to `success` with the preview URL;
`preview-cleanup.yml` confirms teardown on PR close.

## More Information

- Introduced in [cofacts/ai#10](https://github.com/cofacts/ai/pull/10) (authored via Jules,
  merged by @MrOrz).
- The multi-container/sidecar and preview model here is the foundation that later PRs amend. In
  particular, a third `cloudsql-proxy` sidecar (plus the `backend`→`cloudsql-proxy` startup
  dependency and `DATABASE_URL`/GCS env) was added later by
  [`20260506-postgres-session-persistence`](20260506-postgres-session-persistence.md).
