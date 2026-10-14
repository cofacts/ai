---
status: 'proposed'
date: 2026-10-14
decision-makers: [MrOrz]
---

# Serve Storybook from the frontend image

## Context and Problem Statement

Storybook was added in [#154](https://github.com/cofacts/ai/pull/154). We want every preview,
staging and production deploy to show the matching component catalog without separate hosting.

## Decision Outcome

The `Dockerfile` builder stage runs `build-storybook` into `public/storybook` before
`pnpm run build`, so the Cloud Run `ingress` container serves it at `/storybook/`. The catalog
is public, which is fine for an open-source project. The image grows by about 11 MB.

- **It must be built before the app build.** Nitro bakes its static-asset manifest into
  `.output/server/index.mjs` at build time, and files copied into `.output/public` later 404.
- **No separate Docker stage.** The app build would have to wait for the Storybook stage's
  output anyway, and both stages start from `COPY . .`, so splitting buys no parallelism or
  caching.
- **The URL needs the trailing slash.** Storybook uses relative asset paths, so `/storybook`
  (no slash) renders blank. A Nitro `routeRules` redirect from `/storybook` to `/storybook/`
  matches both paths and loops, so we just require `/storybook/` instead.
- **Local development is unchanged.** `pnpm dev` does not serve it; use `pnpm storybook`.
