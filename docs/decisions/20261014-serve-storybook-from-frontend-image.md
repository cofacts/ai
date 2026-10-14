---
status: 'proposed'
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

## Decision Outcome

Chosen: build option 1 and URL option 1. They are the only options that both work and need no
extra config.

### Consequences

- Good, because every deploy serves a catalog that matches its code. A Storybook that fails to
  build also fails the image build.
- Bad, because the image grows by about 11 MB and the Docker build takes longer.
- Neutral, because the catalog is public. That is fine for an open-source project.
- Neutral, because `pnpm dev` does not serve it. Run `pnpm storybook` locally instead.

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
