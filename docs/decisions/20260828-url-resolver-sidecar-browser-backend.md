---
status: 'proposed'
date: 2026-08-28
decision-makers: MrOrz
consulted: nonumpa
informed: Cofacts contributors
---

# Run url-resolver as a Cloud Run sidecar, with a switchable browser backend

## Context and Problem Statement

[#118](https://github.com/cofacts/ai/pull/118) makes `ai_verifier` pre-fetch every plain web
URL through [`cofacts/url-resolver`](https://github.com/cofacts/url-resolver) before its own
model call, so it reads real page text instead of trusting Gemini's `url_context`. That change
is deploy-inert on its own: `URL_RESOLVER_ADDRESS` defaults to `url-resolver:4000`, a
docker-compose service name that does not resolve on Cloud Run. Deployed as-is, every resolve
would take the `RESOLVER_UNAVAILABLE` path and fall back to `url_context` only — the exact
behaviour #118 exists to replace, with nothing loud enough to notice it by.

So #118 needs somewhere to talk to on Cloud Run. This record covers that deployment decision
(`service.template.yaml`, `.github/workflows/deploy.yml`) and the second question it forces:
url-resolver drives a headless chromium, and it is not obvious that chromium survives Cloud
Run's execution model.

The [2026-08-04 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260804.md)
recorded this as the blocker on #118 — "把 url-resolver deploy 到 Cloud Run sidecar，才能在
preview / staging 測試" — after the [2026-07-27 notes](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260804.md)
flagged that #118 had gone a week without progress for want of it.

## Decision Drivers

- **url-resolver is insecure gRPC with no auth.** It must not be reachable from outside the
  instance. This is a hard constraint, not a preference.
- **A silent degrade is worse than a loud failure.** The client buckets an unreachable resolver
  as "no signal" and continues — so any misconfiguration is invisible from the UI.
- **Cloud Run kills the whole instance on a single container's OOM,** which on a 900 s request
  timeout means killing an agent turn mid-flight.
- **Chromium on Cloud Run is unproven for this workload** — a long-lived browser process,
  frozen between requests by CPU throttling.
- Preview and staging must be able to exercise the real path, or #118 cannot be reviewed.

## Considered Options

- **Sidecar container in the existing `cofacts-ai` service**, alongside `ingress`, `backend`
  and `cloudsql-proxy`.
- **A separate Cloud Run service** for url-resolver.
- **Point Cloud Run at the existing url-resolver on the production GCE host.**

For where the browser itself runs, once the sidecar exists:

- **In-container chromium** (url-resolver's default; the Docker image bundles it).
- **Cloudflare Browser Rendering** over url-resolver's `BROWSER_BACKEND=cloudflare` path.
- **Pick one at deploy time**, via a repo variable.

## Decision Outcome

Chosen options: **a sidecar container**, with **the browser backend selected by the
`URL_RESOLVER_BROWSER_BACKEND` repo variable**, defaulting to in-container chromium.

The sidecar follows how rumors-deploy already runs url-resolver in
`docker-compose.sample.yml`, and gets the containment property for free: as a sidecar the gRPC
port is reachable only over the instance's localhost, the same property the compose deployment
gets from its private network. `backend` gains `URL_RESOLVER_ADDRESS=localhost:4000` and a
`container-dependencies` entry. A separate service would have had to be either public or
fronted by IAM auth that url-resolver cannot speak; reusing the GCE instance would have put an
unauthenticated port on the network and re-coupled cofacts.ai to the host that #118's own
project is trying to move work off.

Making the browser backend a **deploy-time variable rather than a code choice** is the part
worth recording. Whether chromium works on Cloud Run is genuinely unknown (see below), and the
two backends have opposite failure modes — local chromium can OOM the instance, Cloudflare can
run out of quota or credentials. A variable makes the switch, and the rollback, a settings
change rather than a PR. Unset renders as an empty string, which url-resolver reads as `local`
(`process.env.BROWSER_BACKEND || 'local'`), so the wiring lands inert and the default stays the
behaviour we already understand.

### Consequences

- Good, because the unauthenticated gRPC port is never on a network, in any environment.
- Good, because PR previews exercise the real resolver path, so #118 becomes reviewable.
- Good, because switching to Cloudflare — or back — is a repo variable, not a deploy of new code.
- Bad, because instance totals grow from 2.5 vCPU / 3.25 GiB to 3.5 vCPU / 5.25 GiB, and the
  sidecar stays sized for local chromium (1 vCPU / 2 GiB) **even when running on Cloudflare**.
  Trimming it to the Cloudflare footprint would OOM the instance the moment someone reverts the
  variable. These limits can only come down once the local fallback is retired for good.
- Bad, because the Cloudflare path adds an external paid dependency and a long-lived credential
  to a pipeline that previously had neither.
- Neutral: url-resolver connects to Cloudflare lazily and lets the session lapse on idle, rather
  than eagerly launching and holding a browser. That happens to suit Cloud Run's scale-to-zero
  and CPU-throttling model better than the local path does.

## Confirmation

The sidecar is confirmed by deploy: a revision reached Ready with all four containers and the
new resource totals, so Cloud Run accepted the fractional CPU sum, pulled the Docker Hub image,
and the sidecar passed its startup probe. Preview serves HTTP 200; CI is green.

The Cloudflare backend is confirmed by a CI guard plus a manual check. The guard fails the
deploy when `URL_RESOLVER_BROWSER_BACKEND` is `cloudflare` while either Cloudflare secret is
empty — the one misconfiguration that would otherwise deploy clean and degrade silently.

**What no automated check covers: whether the browser actually renders.** The startup probe is
TCP on 4000, and the gRPC server binds and stays up whether or not a browser is available, so
the probe passes in both cases. A browser that cannot start surfaces only as
`UNKNOWN_SCRAPE_ERROR` on every resolve, which the client buckets as "no signal" and degrades
past. Rollbar would catch it, but no `ROLLBAR_TOKEN` is configured on the sidecar. So after any
change to the backend, read the sidecar's runtime log directly:

```
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=cofacts-ai
   AND labels."run.googleapis.com/container_name"=url-resolver' \
  --limit 50 --region asia-east1
```

On the **local** backend, `Browser launched successfully.` should appear at container start.
On the **Cloudflare** backend it must not — that path connects lazily, so the line appears only
after the first real scrape. Absence at startup is correct there and proves nothing; send a URL
through the verifier and check for it then.

## Pros and Cons of the Options

### In-container chromium

- Good, because it is url-resolver's default and its best-tested path — the same one running in
  production on GCE today.
- Good, because it has no external dependency, no credential, and no per-use cost.
- Bad, because it is **not confirmed working on Cloud Run**, and the deploy passing is not
  evidence either way. Chromium launches at module load; on failure it logs to a disabled
  Rollbar and leaves the gRPC server up.
- Bad, because the browser is one long-lived process reused across requests and frozen between
  them by CPU throttling. `scrape.js` relaunches on `disconnected`, so a dropped CDP connection
  should self-heal, but the first affected request still fails.
- Bad, because it is what forces the 2 GiB sidecar, and an OOM there takes the whole instance —
  and an in-flight agent turn — with it.

### Cloudflare Browser Rendering

- Good, because it moves the ~500 MB chromium process off the instance entirely, which removes
  the OOM-kills-the-turn risk and the CPU-throttling question in one step.
- Good, because url-resolver's Cloudflare path connects on demand and treats an idle-closed
  session as expected, rather than eagerly holding a browser — a better fit for a container that
  scales to zero.
- Neutral, because the code already exists upstream and is a configuration change here.
- Bad, because it requires a **Workers Paid** plan ($5/month; Workers Free allows 10 minutes of
  browser time per day) plus $0.09 per browser-hour beyond the 10 hours included monthly. At
  ~5 s per resolution, 10k URLs/day is roughly 417 browser-hours ≈ $37/month — and the real
  figure runs higher, because a session is billed until its `keep_alive` window lapses, not
  until the scrape ends. `CLOUDFLARE_KEEP_ALIVE_MS` is the knob for that tail.
- Bad, because it introduces a long-lived account-scoped API token into the deploy pipeline.
- Bad, because its failure modes (bad token, exhausted quota) are as silent as chromium's: the
  connect error lands in the same disabled Rollbar. The CI guard closes the "forgot the secret"
  case; the rest still needs the log check above.

## More Information

- Driving PRs: [#118](https://github.com/cofacts/ai/pull/118) (the client),
  [#123](https://github.com/cofacts/ai/pull/123) (this deployment).
- Supersedes nothing, but extends
  [Cloud Run multi-container deployment](20260303-cloud-run-multi-container-deploy.md) from
  three containers to four.
- The verifier-side reasoning is recorded separately in
  [Pre-fetch real page text for the verifier via url-resolver](20260722-url-resolver-verifier-prefetch.md).
- Cloudflare's token scope is account-level **Browser Rendering: Edit**; nothing zone-scoped is
  needed. Pricing and limits:
  https://developers.cloudflare.com/browser-run/pricing/ and
  https://developers.cloudflare.com/browser-run/limits/
- **Revisit when**: the local backend is confirmed working (or not) on Cloud Run with real
  traffic. Either answer retires the variable — confirmation lets the Cloudflare path go, a
  failure makes Cloudflare the only option and frees the sidecar to shrink.
