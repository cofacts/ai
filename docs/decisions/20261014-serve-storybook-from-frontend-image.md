---
status: 'accepted'
date: 2026-10-14
decision-makers: [MrOrz]
---

# Serve Storybook from the frontend image

## Context and Problem Statement

Storybook was added in [#154](https://github.com/cofacts/ai/pull/154). We want every preview,
staging and production deploy to show the matching component catalog without separate hosting.
That raises two questions: where in the `Dockerfile` to build it, and how to handle `/storybook`
without a trailing slash. Storybook uses relative asset paths, so that URL renders blank.

## Considered Options

Build placement:

1. Build into `public/storybook` in the builder stage, before `pnpm run build`
2. Separate Docker stage, copied into `.output/public` after the app build
3. Separate Docker stage, copied into `public/storybook` before the app build

URL handling:

1. Require `/storybook/` (with the trailing slash)
2. Nitro `routeRules` redirect from `/storybook` to `/storybook/`
3. Nitro `routeRules` redirect from `/storybook` to `/storybook/index.html`
4. `<base href="/storybook/">` injected through `managerHead` in production builds
5. A script injected through `managerHead` in production builds that sends `/storybook` to
   `/storybook/`

## Decision Outcome

Chosen: build option 1 and URL option 5. Build option 1 is the simplest that works; URL option
5 is the only one that makes `/storybook` work without touching the app's server config.

### Consequences

- Good, because every deploy serves a catalog that matches its code. A Storybook that fails to
  build also fails the image build.
- Bad, because the image grows by about 11 MB and the Docker build takes longer.
- Neutral, because the catalog is public. That is fine for an open-source project.
- Bad, because Storybook shares the app's origin, and the BFF authenticates with a same-origin
  HttpOnly cookie ([BFF auth](20260509-bff-auth-httponly-cookie.md)). An XSS in Storybook, its
  addons, or a story that renders URL-controlled args (`?args=`) or untrusted markup could call
  the app's server functions with the visitor's session. We accept this while stories render
  only fixtures and Storybook carries no third-party addons. Revisit, for example by moving it
  to its own origin or to preview deploys only, if either changes.
- Neutral, because the Docker build is the only one that writes `public/storybook`. A copy
  left there from reproducing it locally is served by `pnpm dev` too, and may be stale; delete
  it, and use `pnpm storybook` for local work.

## Pros and Cons of the Options

### Build placement

- **Option 1 (builder stage, chosen):** good, because it is one `RUN` line.
- **Option 2 (copy into `.output/public` after the app build):** does not work, because Nitro
  bakes its static-asset manifest into `.output/server/index.mjs` at build time. When tested,
  every `/storybook/*` path returned 404.
- **Option 3 (separate stage, copied in before the app build):** works, and `--target` can build
  Storybook alone. But the app build has to wait for that stage, and both stages start from
  `COPY . .`, so it adds no parallelism or caching.

### URL handling

- **Option 1 (require `/storybook/`, chosen):** good, because it needs no config. Bad, because
  `/storybook` without the slash renders a blank page.
- **Option 2 (redirect to `/storybook/`):** does not work, because the rule also matches
  `/storybook/`. When tested, it redirected to itself in a loop.
- **Option 3 (redirect to `/storybook/index.html`):** works when tested. Bad, because it adds a
  rule to `vite.config.ts`, and every visit lands on a URL ending in `index.html`.
- **Option 4 (`<base>`):** only partly works. `managerHead` is inserted after Storybook's own
  `modulepreload` links and `@font-face` rules, which still resolve against `/`. When tested,
  `/storybook` rendered, but those requests 404ed and the UI fell back to another font.
- **Option 5 (redirect script, chosen):** works when tested. `/storybook` and its query string
  land on `/storybook/`. The two `modulepreload` requests that start before the script runs
  still 404, with no visible effect. The config lives in `.storybook/main.ts`.
