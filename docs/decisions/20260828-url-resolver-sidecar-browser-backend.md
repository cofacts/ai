---
status: 'proposed'
date: 2026-08-28
decision-makers: MrOrz
consulted: nonumpa
informed: Cofacts contributors
---

# Run url-resolver as a Cloud Run sidecar, with its browser on Cloudflare

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
- **Pick one at deploy time**, via a repo variable — shipped first, then reverted (below).

## Decision Outcome

Chosen options: **a sidecar container**, with its browser **pinned to Cloudflare Browser
Rendering** and the container sized for that.

The sidecar follows how rumors-deploy already runs url-resolver in
`docker-compose.sample.yml`, and gets the containment property for free: as a sidecar the gRPC
port is reachable only over the instance's localhost, the same property the compose deployment
gets from its private network. `backend` gains `URL_RESOLVER_ADDRESS=localhost:4000` and a
`container-dependencies` entry. A separate service would have had to be either public or
fronted by IAM auth that url-resolver cannot speak; reusing the GCE instance would have put an
unauthenticated port on the network and re-coupled cofacts.ai to the host that #118's own
project is trying to move work off.

For the browser, this record first shipped a deploy-time switch (`URL_RESOLVER_BROWSER_BACKEND`,
defaulting to local chromium) on the reasoning that chromium-on-Cloud-Run was unproven and a
variable makes the rollback free. **That was reverted before merge**, because the switch was not
actually free: keeping a revert to local chromium viable meant keeping the container sized for
chromium — 1 vCPU / 2048 MiB — permanently, on every revision, whether or not a browser ever
started in it. An option nobody exercises, billed continuously, on a service that runs
`minScale: 0` precisely to avoid paying for idle.

So the backend is pinned in `service.template.yaml` and the sidecar drops to **0.5 vCPU /
512 MiB**, roughly 10x its measured 45 MiB idle footprint on this path. Instance totals go from
2.5 vCPU / 3.25 GiB before the sidecar, to 3.0 vCPU / 3.75 GiB — where the switchable version
would have cost 3.5 vCPU / 5.25 GiB. Reverting to a local chromium is now a code change to two
places at once (the `BROWSER_BACKEND` value and the resource limits), which is the intended
coupling: they are not independently correct, and a revert that changes only one of them OOMs
the instance.

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

**The startup probe, not the dependency, is the operative gate.** Cloud Run's container runtime
contract requires that "all containers within the instance need to be healthy" for an instance to
serve, so any startup probe on the sidecar gates the whole revision regardless of what depends on
it. Removing only the `container-dependencies` entry would have changed startup ordering and left
the availability coupling intact. What the dependency did do was make the probe _mandatory_ —
Cloud Run rejects a deployment with "Dependent container must have startup probe specified" — so
both had to go, and the annotation now lists only `cloudsql-proxy`.

Nothing is lost with the probe. It could only ever be `tcpSocket`, and the gRPC server binds
before any browser is contacted, so passing it proved the port was open and never that a page
could be rendered — precisely the gap the rest of this record is about. Meanwhile the exposure it
created was concrete rather than hypothetical, because the image is the mutable
`docker.io/cofacts/url-resolver:latest`: an upstream push that broke startup would have taken the
site down on the next cold start, with no deploy on this side to correlate it against.

This does not make the sidecar wholly unable to affect the instance — a container that _exits_
still terminates it, and that is not configurable away. What it removes is the failure-to-bind
case, which is the one reachable without a deploy here.

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
- Bad, because the deploy now hard-depends on a Workers Paid plan and a long-lived
  account-scoped API token; the two Cloudflare secrets are required for any deploy to succeed.
- Neutral: url-resolver connects to Cloudflare lazily and lets the session lapse on idle, rather
  than eagerly launching and holding a browser. That suits Cloud Run's scale-to-zero and
  CPU-throttling model better than the local path did.
- Neutral: moving the browser off-instance made the client's default resolve deadline too tight,
  so `URL_RESOLVER_TIMEOUT` is now set explicitly in the template (see Confirmation) instead of
  being inherited from the library.

## Confirmation

The sidecar is confirmed by deploy: a revision reached Ready with all four containers and the
new resource totals, so Cloud Run accepted the fractional CPU sum, pulled the Docker Hub image,
and the sidecar passed its startup probe. Preview serves HTTP 200; CI is green.

The Cloudflare credentials are confirmed by a CI guard: the deploy workflow refuses to render
`service.yaml` when either secret is empty — the misconfiguration that would otherwise deploy
clean and degrade silently.

The resolve budget is set rather than inherited. `URL_RESOLVER_TIMEOUT` is a deadline for the
_whole_ `ResolveUrl` stream, not per URL — the client passes it straight to the streaming RPC and
marks every URL still unanswered when the stream ends as `TIMEOUT`, another status it treats as
"no signal". The library default of 30 s does not clear the arithmetic on this path: up to 20 URLs
(`URL_RESOLVER_MAX_URLS`) at `SCRAPE_MAX_CONCURRENCY` 3 is roughly seven waves, each now a round
trip to a remote browser rather than an in-process one. So the template sets 120 s, which makes
the budget a deploy-visible decision and keeps a link-heavy message from silently resolving
nothing. It also caps user-visible latency, because the pre-fetch blocks the verifier's model
call.

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

`Browser launched successfully.` must **not** appear at container start: the Cloudflare path
connects lazily, so the line appears only after the first real scrape. Absence at startup is
correct and proves nothing — send a URL through the verifier, then look for it.

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
- Bad, because it is what forces the 1 vCPU / 2 GiB sidecar — billed on every revision, idle or
  not — and an OOM there takes the whole instance, and an in-flight agent turn, with it.

### Cloudflare Browser Rendering

- Good, because it moves the ~500 MB chromium process off the instance entirely, which removes
  the OOM-kills-the-turn risk and the CPU-throttling question in one step.
- Good, because url-resolver's Cloudflare path connects on demand and treats an idle-closed
  session as expected, rather than eagerly holding a browser — a better fit for a container that
  scales to zero.
- Neutral, because the code already exists upstream and is a configuration change here.
- Good, because with no local chromium to keep viable, the sidecar can hold 0.5 vCPU / 512 MiB
  instead of 1 vCPU / 2 GiB.
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
- **Revisit when**: Cloudflare browser-hour spend exceeds what a standing chromium-sized
  sidecar would have cost (roughly, when sustained volume passes ~10k URLs/day), or when a
  Cloudflare outage causes a user-visible regression. Either would reopen the local backend —
  which would mean restoring both the `BROWSER_BACKEND` value and the 1 vCPU / 2048 MiB limits,
  and would still leave chromium-on-Cloud-Run unproven.
