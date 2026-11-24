---
status: 'accepted'
date: 2026-11-24
decision-makers: Johnson Liang
---

# Keep runs going after the browser leaves, with Redis Streams as the run registry

## Context and Problem Statement

A turn of the AI assistant (one "run") can take minutes: the writer calls the investigator and
verifier as `AgentTool`s, and a single model call has run for 195s. Until now the run's life
was the HTTP connection's. The browser POSTs to the BFF's `/api/run-sse`, which proxies ADK's
`/run_sse` and forwards `request.signal`; when the tab closes, the phone sleeps or the network
drops, ADK cancels the run. Since ADK 2.11 `/run_sse` always does this, with no option to turn
it off (google/adk-python#4029). The user comes back to half a process and no answer.
`resumeRun(invocationId)` existed in the frontend but was never used: resuming an aborted
invocation shows the model "Invocation was aborted" as tool results, and it doesn't finish the
work.

A second window on the same session had no way to see a run going on elsewhere either, nor
a message sent from another window, short of reloading.

Scope: BFF (new `src/server/runBus.ts` and the `/api/runs/:sessionId/{events,start,cancel}`
routes, `markSessionOpened`, `updateSessionTitle`), frontend chat cache and session page, one ADK
plugin (`KeepPartialOnAbortPlugin`), and deployment (Redis for Cloud Run and GCE, CPU
throttling). ADK's server and run flow are unchanged.

Design write-up with sequence diagrams for each scenario:
<https://claude.ai/code/artifact/476433b8-0352-4ab0-9148-796630816d41> (2026-10-30).

## Decision Drivers

- A run must survive its viewer: closing the tab only stops watching.
- Any number of windows, on any device, can watch the same run live, and a window opened
  mid-run sees what was already typed.
- A window shows what another window sends without a reload, as Claude on the web does.
- dev.cofacts.ai and PR previews run on Cloud Run with up to 3 instances; a viewer's request
  can land on a different instance than the run.
- No new infrastructure to operate. Production's GCE docker compose already runs a `redis`
  container (for rumors-line-bot); the staging LINE bot uses a free Redis Cloud instance.
- The frontend's existing SSE parser and `applyEventToState` should keep working unchanged.
- ADK stays as shipped: our code shouldn't depend on ADK's internals, so upgrades stay easy.

## Considered Options

Where the run's events live:

- Run registry in the ADK process's memory (an asyncio fan-out per run)
- Run registry in Redis Streams, shared with rumors-line-bot's Redis
- Keep `/run_sse` and use ADK's resume to continue an interrupted invocation

Who drains the run (added 2026-11-24; the two were built side by side, cofacts/ai#197 and the
PR adding this record):

- The BFF holds ADK's own `/run_sse` connection, in a task no browser request owns
- ADK runs it: our routes on ADK's app, sharing its `Runner` (cofacts/ai#197)

How an idle window learns that a new run started (added 2026-11-22, when the feed became
persistent):

- Wait on the same Redis Stream, one blocking read per ADK process for all watched sessions
- A separate notification channel: Google Pub/Sub, Postgres `LISTEN/NOTIFY`, or Cloudflare
  Queues
- The BFF polls ADK, and connects to the run's stream when it sees a new one

## Decision Outcome

Chosen options: "Run registry in Redis Streams", because it decouples executing a run from
watching it across processes, needs no fan-out code of our own, and reuses a Redis we already
have; and "The BFF holds ADK's own `/run_sse` connection", because it gets the same behaviour
with ADK's server unchanged (see the pros and cons below).

How it works:

- `POST /api/runs/:sid/start` takes a per-session lock (`SET NX`, 30s TTL renewed by the
  owner), opens ADK's `/run_sse`, and drains it in a task no request owns: closing the tab
  doesn't close that connection, so ADK doesn't cancel the run. A second start on a busy
  session gets 409 and the client watches the run going on.
- Every frame, partial or not, is appended to a per-session Redis Stream in 50ms batches.
  `/run_sse` doesn't send the user's message, so the owner reads the stored one from the
  session API once the first frame names the invocation, and writes it first.
- Each open session page keeps one feed, `GET .../events?since=<event id>`, which never ends
  by itself. It sends the stored events after `since` (`event: history`), then the latest run
  from its first entry (`XRANGE`, minus partials a later complete event covers), then
  `event: synced`, then each run live as it is written, each followed by `event: end` with its
  outcome. The next run, started from any window, arrives on the same feed: it writes to the
  same stream key, which the feed is already waiting on. Heartbeats every 20s keep Cloudflare
  from cutting a quiet feed.
- One `XREAD BLOCK` per BFF process waits on every watched session's stream at once (XREAD
  takes many keys) and hands entries to the feeds (`StreamHub`), so Redis connections grow
  with processes, not with open tabs.
- At a run's end the feed also sends the run's stored events it didn't stream (a failed batch
  write, entries trimmed by MAXLEN, ADK's abort marker), so the window ends with the full
  record.
- The client keeps complete events by ADK event id (they can arrive
  stored and again from a replay) in time order, and trusts the replay for the run in
  progress. On a dropped connection (network change, Cloud Run's 900s request limit) it
  reconnects with `since`; nothing polls.
- Stop is a request (`POST .../cancel`), not a browser disconnect: the owner aborts its
  `/run_sse` request, and ADK cancels the run and stores its `INVOCATION_ABORTED` marker. A
  cancel landing on a non-owner process sets a Redis flag the owner checks every second.
  ADK stores none of the partial events of the message being typed, so an ADK plugin,
  `KeepPartialOnAbortPlugin`, remembers their text and puts it on the abort marker as ADK
  appends it (`on_event_callback` sees every event before it is stored, and ADK merges the
  fields a plugin sets onto it). History then keeps the answer cut where it stopped, and the
  model sees on the next turn where it was interrupted. The run's `end`
  frame says `cancelled` (user) or `interrupted` (redeploy, 15-minute limit, error); a window
  watching offers "重新提問" for `interrupted`, and any window does for a turn whose history
  ends without an answer.
- On SIGTERM the BFF interrupts its runs at once rather than waiting for them. The BFF and ADK
  are deployed together, so a redeploy interrupts runs either way.
- Writing session state during a run kills the run (`StaleSessionError`). Opening a session
  and renaming write through the BFF, which holds the session lock while it writes, skips
  `lastOpenedAt` while a run holds the session, and refuses a rename then.
- Without `REDIS_URL` the routes answer 503 `{"reason": "disabled"}` and the client falls
  back to `/api/run-sse`.
- The BFF talks to Redis with `redis` (node-redis), the client Redis recommends for new
  projects; ioredis is in best-effort maintenance.

### Consequences

- Good, because closing the tab, a phone going to sleep or a network change no longer loses
  the turn, and every window shows the same live output, including messages sent from
  another window.
- Good, because Cloud Run doesn't need to be limited to one instance.
- Bad, because a run left unwatched now runs to the end and costs model calls; the 15-minute
  limit bounds it. There is no per-user concurrency limit: a run exists only while the agent
  works, not while it waits for the user.
- Bad, because a redeploy interrupts the turns in progress; users are asked to ask again.
- Bad, because Cloud Run needs CPU throttling off (instance-based billing) when Redis is set,
  since the run works after its HTTP response has ended.
- Bad, because on Cloud Run (dev.cofacts.ai and PR previews, not production) a run can still
  be cut short once every window is closed. An open feed is a request in progress, so this
  only happens with no window open. With no open request, Cloud Run counts the
  instance as idle and may scale it in; it keeps idle instances only "up to 15 minutes" (see
  [instance autoscaling](https://cloud.google.com/run/docs/about-instance-autoscaling)).
  Scale-in sends SIGTERM, so the run is sealed as `interrupted` like on a redeploy, and the
  next visit shows the text typed so far with 重新提問. We accept this rather than set
  `minScale: 1`: these environments are for developers, and closing every window usually
  means they are done testing. Production on GCE doesn't scale in.
- Neutral: Redis holds only runs in progress; every key has a TTL and the `cofacts-ai:`
  prefix, because the production Redis is shared with rumors-line-bot and has no `maxmemory`.

## Confirmation

- `src/server/__tests__/runBus.test.ts` (a real Redis via `TEST_REDIS_URL`, which CI
  provides, and a fake ADK): viewers from the start and mid-run, disconnects, 409, cancel on
  and off the owner, owner death, state writes, shutdown, ADK refusing a run; one feed across
  runs from different processes, `since`, catch-up at a run's end, a feed joining behind the
  hub, feeds sharing the hub.
- `src/lib/__tests__/chatCache.runs.test.ts`: the client's merge, dedupe and reconnect rules.

## Pros and Cons of the Options

### Run registry in the ADK process's memory

- Good, because there is nothing new to deploy.
- Bad, because viewers must reach the owning process: Cloud Run would have to run a single
  instance, and more uvicorn workers would need a redesign.
- Bad, because we would write our own fan-out, including what to do with slow viewers.
- Bad, because when the owner dies, viewers learn nothing until their connection drops.

### Keep `/run_sse` and resume

- Good, because it's ADK's own mechanism.
- Bad, because, tried in practice, the resumed model sees "Invocation was aborted" and does
  not finish the work; and it doesn't let a second window watch.

### The BFF holds ADK's own `/run_sse` connection (chosen)

- Good, because ADK is unchanged: no routes of ours on ADK's app, and no reaching into
  `get_fast_api_app()` for its `Runner`, which an ADK upgrade could break.
- Good, because everything about Redis lives in one language, next to the client it serves.
- Neutral, because a BFF restart now interrupts runs too; the BFF and ADK are always deployed
  together, so a redeploy already did.
- Neutral, because the text being typed when a run stops reaches history through an ADK
  plugin on the abort marker rather than from the BFF, since ADK's HTTP API can't add an
  event with content. A crashed ADK process runs no code, so that text is lost then, as with
  #197.
- Bad, because the stored history can't tell a user's stop from an interruption (ADK stores
  the same marker), so only a window that watched the end knows which it was.

### ADK runs it (cofacts/ai#197)

- Good, because the owner can store how the run ended (stop or interruption) with the typed
  text, via ADK's own session service.
- Bad, because it adds our routes to ADK's app and shares its `Runner`, found by reaching into
  `get_fast_api_app()`'s internals; about 1,000 lines of Python next to ADK.

### Wake idle feeds through the same Redis Stream (chosen)

- Good, because every new message enters through our `POST .../start`, which writes the run to
  the session's stream key; a feed waiting on that key wakes for it, with nothing new to run.
- Good, because the stream already holds what a late window must replay; any separate
  notification channel would sit next to it, not replace it.
- Neutral, because a newly watched key joins the hub's next read, up to 1s later; the feed has
  already read up to that point itself, so it misses nothing.

### A separate notification channel (Pub/Sub, Postgres `LISTEN/NOTIFY`, Cloudflare Queues)

- Good, because a Postgres trigger on the events table could announce every write, even ones
  that don't go through our routes.
- Bad, because none of them replays what a window missed, so the partial text of a run in
  progress, which only Redis holds, still needs Redis.
- Bad, because `LISTEN` moves the per-listener connection problem to Postgres (Cloud SQL), and
  `NOTIFY` payloads are capped at 8KB. Google Pub/Sub is built for a subscription per service,
  not per browser tab, and Cloudflare Queues deliver each message to one consumer.

### The BFF polls and connects to runs on demand

- Good, because ADK would hold no connection while a session is idle.
- Bad, because polling adds latency or load, and the BFF would need to know Redis's layout or
  ADK's run state. The hub already makes idle feeds cheap.

## More Information

- Not yet measured: concurrency limits of the event loop, SQLAlchemy's default pool, and
  Vertex quotas under many simultaneous runs; Redis Cloud free-plan memory (30 MB, shared
  with the staging LINE bot) under load. Connections are one blocking read per BFF process
  plus one for commands. If the free plan is too small, a `redis:alpine` sidecar with
  `maxScale 1` works with no code change.
- Production (GCE) needs `REDIS_URL=redis://redis:6379` in the frontend (`cofacts-ai`)
  service's env file in rumors-deploy.
