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

Recorded in the Cofacts weekly meetings while the app was being stood up:

- Keep hosting cheap and simple — the staging service ran at `min instance = 0`
  ([2026-03-05 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260305.md)).
- Don't expose the Python ADK API publicly — the Tanstack Start server proxies it (same
  meeting).
- Ship and run the frontend/BFF and the ADK backend together.

## Considered Options

Alternatives the team actually weighed (per the meeting notes and the PR discussion), not
reconstructed:

- **Hosting platform** — Cloud Run vs. Linode
  ([2026-02-10 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260210.md)).
- **Deploy topology** — build the Tanstack Start and Python ADK images separately and put
  **both in one Cloud Run service as sidecars** (communicating over `localhost`, with the ADK
  proxied by the frontend rather than exposed directly) — the chosen approach
  ([2026-03-05 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260305.md)).
- **Secrets delivery** — Google Secret Manager (the initial approach) vs. GitHub repository
  secrets injected via `envsubst` at deploy time; pivoted to the latter mid-PR after a Secret
  Manager IAM permission error
  ([#10 discussion](https://github.com/cofacts/ai/pull/10#issuecomment-3977901879)).

Workload Identity Federation and the 0%-traffic preview-revision model (see Decision Outcome)
are how #10 implemented the chosen option; they weren't recorded as compared alternatives.

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
