---
status: 'proposed'
date: 2026-08-28
decision-makers: MrOrz
consulted: nonumpa
informed: Cofacts contributors
---

# Run url-resolver as a Cloud Run sidecar

## Context and Problem Statement

[#118](https://github.com/cofacts/ai/pull/118) makes `ai_verifier` pre-fetch every plain web
URL through [`cofacts/url-resolver`](https://github.com/cofacts/url-resolver) before its own
model call, so it reads real page text instead of trusting Gemini's `url_context`. That change
is deploy-inert on its own: `URL_RESOLVER_ADDRESS` defaults to `url-resolver:4000`, a
docker-compose service name that does not resolve on Cloud Run. Deployed as-is, every resolve
would take the `RESOLVER_UNAVAILABLE` path and fall back to `url_context` only — the exact
behaviour #118 exists to replace, with nothing loud enough to notice it by.

So #118 needs somewhere to talk to on Cloud Run — and, because url-resolver drives a headless
chromium, a second question follows: whether that chromium survives Cloud Run's execution model
at all. The [2026-08-04 meeting](https://github.com/cofacts/kb/blob/main/src/meetings/2026/20260804.md)
recorded this as the blocker on #118: 「把 url-resolver deploy 到 Cloud Run sidecar，才能在
preview / staging 測試」.

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
- **Pick one at deploy time**, via a repo variable — shipped first, then reverted (below).

## Decision Outcome

Chosen options: **a sidecar container**, with its browser **pinned to Cloudflare Browser
Rendering** and the container sized for that.

The sidecar follows how rumors-deploy already runs url-resolver in
`docker-compose.sample.yml`, and gets containment for free: the gRPC port is reachable only over
the instance's localhost, the same property compose gets from its private network, so `backend`
just points `URL_RESOLVER_ADDRESS` at `localhost:4000`. A separate service would have had to be
either public or fronted by IAM auth url-resolver cannot speak; reusing the GCE instance would
have put an unauthenticated port on the network and re-coupled cofacts.ai to the host this
project is trying to move work off.

For the browser, this record first shipped a deploy-time switch
(`URL_RESOLVER_BROWSER_BACKEND`, defaulting to local chromium), on the reasoning that
chromium-on-Cloud-Run was unproven and a variable makes rollback free. **That was reverted before
merge**: keeping the revert viable meant keeping the container sized for chromium — 1 vCPU /
2048 MiB — on every revision whether or not a browser ever started in it, which is an option
nobody exercises billed continuously, on a service that runs `minScale: 0` precisely to avoid
paying for idle.

So the backend is pinned and the sidecar drops to **0.5 vCPU / 512 MiB**, ~10x its measured
45 MiB idle footprint on this path. Instance totals go from 2.5 vCPU / 3.25 GiB before the
sidecar to 3.0 vCPU / 3.75 GiB, where the switchable version would have cost 3.5 / 5.25.
Reverting now takes a code change in two places at once — the `BROWSER_BACKEND` value and the
resource limits — which is the intended coupling: they are not independently correct, and
changing only one OOMs the instance.

Local chromium remains url-resolver's default everywhere else, including docker-compose for
local development. Only the Cloud Run deployment is pinned.

### A failing sidecar must degrade, not take the service down

The client is written so that an absent resolver is survivable: `resolve_urls()` buckets an
unreachable one as `RESOLVER_UNAVAILABLE`, documented in its `ResolveStatus` docstring as "no
signal", and the verifier proceeds on `url_context`. A graceful degrade is only worth writing if
the deployment permits it to happen, and the first version of this sidecar did not — it gave
`url-resolver` a `tcpSocket` startup probe and listed it in `backend`'s `container-dependencies`,
which together meant a sidecar that could not bind port 4000 stopped the revision from ever
becoming Ready. The fact-checking service _unavailable_ rather than _degraded_, over a dependency
built to be optional.

**The startup probe, not the `container-dependencies` entry, is the operative gate** — Cloud Run
requires every container in an instance to be healthy before it serves, so a probe on the sidecar
gates the whole revision no matter what depends on it. Dropping the dependency alone would have
left the coupling intact; what the dependency did was make the probe mandatory, so both went. The
mechanics are spelled out at both sites in `service.template.yaml`.

The probe cost nothing to lose: `tcpSocket` on a gRPC server that binds before any browser is
contacted proved the port was open and never that a page could be rendered. A container that
_exits_ still terminates the instance and that is not configurable away; what this removes is the
failure-to-bind case, which the mutable `:latest` tag makes reachable with no deploy on our side.

### Consequences

- Good, because the unauthenticated gRPC port is never on a network, in any environment.
- Good, because PR previews exercise the real resolver path, so #118 becomes reviewable.
- Good, because the ~500 MB chromium process leaves the instance entirely, taking the
  OOM-kills-the-agent-turn risk and the CPU-throttling question with it, and letting the sidecar
  cost a third of what the switchable version did.
- Bad, because a Cloudflare outage or an exhausted quota now has **no fallback**: url-resolver
  fails every resolve and the verifier degrades to `url_context` only. That degrade is silent by
  the client's design (see Confirmation), so it will not announce itself. Accepted knowingly —
  the alternative was paying for a standing chromium-sized container to hedge it.
- Bad, because the deploy now hard-depends on a **Workers Paid** plan and a long-lived
  account-scoped API token; the two Cloudflare secrets are required for any deploy to succeed.
  Cost is $5/month (the free tier allows 10 minutes of browser time per day) plus $0.09 per
  browser-hour beyond the 10 hours included. At ~5 s per resolution, 10k URLs/day is roughly 417
  browser-hours ≈ $37/month — and the real figure runs higher, because a session is billed until
  its `keep_alive` window lapses, not until the scrape ends. `CLOUDFLARE_KEEP_ALIVE_MS` is the
  knob for that tail.
- Neutral: the option not taken, in-container chromium, remains url-resolver's best-tested path
  and needs no credential — but it is **unproven on Cloud Run** (chromium launches at module
  load and logs failures to a disabled Rollbar, so a green deploy says nothing), and it is what
  forced the 1 vCPU / 2 GiB sidecar in the first place.
- Neutral: url-resolver connects to Cloudflare lazily and lets the session lapse on idle, rather
  than eagerly launching and holding a browser. That suits Cloud Run's scale-to-zero and
  CPU-throttling model better than the local path did.
- Neutral: moving the browser off-instance made the client's default resolve deadline too tight,
  so `URL_RESOLVER_TIMEOUT` is now set explicitly in the template (see Confirmation) instead of
  being inherited from the library.

## Confirmation

Deploy confirms the topology: a revision reaches Ready with all four containers and the new
resource totals, so Cloud Run accepts the fractional CPU sum, pulls the Docker Hub image, and
serves with a sidecar that carries no startup probe. Preview returns HTTP 200; CI is green. The
Cloudflare credentials are confirmed separately by a CI guard that refuses to render
`service.yaml` when either secret is empty.

**What no automated check covers: whether the browser actually renders.** The gRPC server binds
and stays up whether or not a browser is reachable, and a browser that cannot start surfaces only
as `UNKNOWN_SCRAPE_ERROR` on every resolve — which the client buckets as "no signal" and degrades
past. Rollbar would catch it, but the sidecar has no `ROLLBAR_TOKEN`. So after any change to the
backend, read its runtime log directly:

```
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=cofacts-ai
   AND labels."run.googleapis.com/container_name"=url-resolver' \
  --limit 50 --region asia-east1
```

`Browser launched successfully.` must **not** appear at container start: the Cloudflare path
connects lazily, so the line appears only after the first real scrape. Absence at startup is
correct and proves nothing — send a URL through the verifier, then look for it.

## More Information

- Driving PRs: [#118](https://github.com/cofacts/ai/pull/118) (the client),
  [#123](https://github.com/cofacts/ai/pull/123) (this deployment). Extends
  [Cloud Run multi-container deployment](20260303-cloud-run-multi-container-deploy.md) from three
  containers to four; the verifier-side reasoning is separate, in
  [the page pre-fetch record](20260722-url-resolver-verifier-prefetch.md).
- Cloudflare token scope is account-level **Browser Rendering: Edit**, nothing zone-scoped.
  [Pricing](https://developers.cloudflare.com/browser-run/pricing/) ·
  [limits](https://developers.cloudflare.com/browser-run/limits/).
- **Revisit when** Cloudflare browser-hour spend exceeds what a standing chromium-sized sidecar
  would have cost (roughly, sustained volume past ~10k URLs/day), or a Cloudflare outage causes a
  user-visible regression. Either reopens the local backend — restoring both the
  `BROWSER_BACKEND` value and the 1 vCPU / 2048 MiB limits, and still leaving
  chromium-on-Cloud-Run unproven.
