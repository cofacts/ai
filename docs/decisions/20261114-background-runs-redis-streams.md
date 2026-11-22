---
status: 'accepted'
date: 2026-11-22
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

Scope: ADK backend (`adk/main.py`, new `adk/cofacts_ai/run_bus.py`), BFF (new
`/api/runs/:sessionId/:action`, `markSessionOpened`, `updateSessionTitle`), frontend chat
cache and session page, and deployment (Redis for Cloud Run and GCE, CPU throttling).

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

## Considered Options

Where the run's events live:

- Run registry in the ADK process's memory (an asyncio fan-out per run)
- Run registry in Redis Streams, shared with rumors-line-bot's Redis
- Keep `/run_sse` and use ADK's resume to continue an interrupted invocation

How an idle window learns that a new run started (added 2026-11-22, when the feed became
persistent):

- Wait on the same Redis Stream, one blocking read per ADK process for all watched sessions
- A separate notification channel: Google Pub/Sub, Postgres `LISTEN/NOTIFY`, or Cloudflare
  Queues
- The BFF polls ADK, and connects to the run's stream when it sees a new one

## Decision Outcome

Chosen option: "Run registry in Redis Streams", because it decouples executing a run from
watching it across processes, needs no fan-out code of our own, and reuses a Redis we already
have.

How it works:

- ADK keeps its routes but we add our own on the same app, sharing ADK's `Runner` (found
  behind `get_fast_api_app()`; `test_main_runs.py` guards that). `POST .../runs` takes a
  per-session lock (`SET NX`, 30s TTL renewed by the owner), then drains
  `runner.run_async(yield_user_message=True)` in an `asyncio` task no request owns, and
  answers 202 with the invocation id once the user's message is stored. A second start on a
  busy session gets 409 and the client attaches to the run going on.
- Every event, partial or not, is appended to a per-session Redis Stream in 50ms batches.
- Each open session page keeps one feed, `GET .../events?since=<event id>`, which never ends
  by itself. It sends the stored events after `since` (`event: history`), then the latest run
  from its first entry (`XRANGE`, minus partials a later complete event covers), then
  `event: synced`, then each run live as it is written, each followed by `event: end` with its
  outcome. The next run, started from any window, arrives on the same feed: it writes to the
  same stream key, which the feed is already waiting on. Heartbeats every 20s keep Cloudflare
  from cutting a quiet feed.
- One `XREAD BLOCK` per ADK process waits on every watched session's stream at once (XREAD
  takes many keys) and hands entries to the feeds (`StreamHub`), so Redis connections grow
  with processes, not with open tabs.
- At a run's end the feed also sends the run's stored events it didn't stream (a failed batch
  write, entries trimmed by MAXLEN), so the window ends with the full record.
- The BFF only forwards. The client keeps complete events by ADK event id (they can arrive
  stored and again from a replay) in time order, and trusts the replay for the run in
  progress. On a dropped connection (network change, Cloud Run's 900s request limit) it
  reconnects with `since`; nothing polls.
- Stop is a request (`POST .../runs/cancel`), not a disconnect. A cancel landing on a
  non-owner process sets a Redis flag the owner checks every second. Stopping uses ADK's
  `abort_signal`; the owner then stores the text already typed as a final event with
  `customMetadata.cofacts_run_end` = `cancelled` (user) or `interrupted` (redeploy, 15-minute
  limit, error). The client offers "重新提問" for `interrupted`, and for a turn whose history
  ends without an answer (the owner died).
- On SIGTERM the process interrupts its runs at once rather than waiting for them.
- Writing session state during a run kills the run (`StaleSessionError`). Opening a session
  used to PATCH `lastOpenedAt`; it now goes through `POST .../opened`, which skips the write
  while a run holds the session. Renaming is refused during a run.
- Without `REDIS_URL` the new routes answer 503 and the client falls back to `/api/run-sse`.

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

- `adk/cofacts_ai/tests/test_run_bus.py` (fakeredis, or a real server via `TEST_REDIS_URL`):
  viewers from the start and mid-run, disconnects, 409, cancel on and off the owner,
  owner death, heartbeat, deferred `opened`, shutdown, time limit, errors; one feed across
  runs started by different processes, `since`, catch-up at a run's end, feeds sharing the
  hub.
- `adk/cofacts_ai/tests/test_run_bus_adk.py`: the same against a real ADK `Runner` and
  `DatabaseSessionService`, including the stored end-of-run event after an abort.
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

### Wake idle feeds through the same Redis Stream (chosen)

- Good, because every new message enters through our `POST .../runs`, which writes the run to
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
  with the staging LINE bot) under load. Connections are one blocking read per ADK process
  plus the pool's short-lived ones. If the free plan is too small, a `redis:alpine` sidecar
  with `maxScale 1` works with no code change.
- Production (GCE) needs `REDIS_URL=redis://redis:6379` in the `adk` service's env file in
  rumors-deploy.
