# --- builder ---
FROM node:22-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Install deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
# Storybook goes into public/ before the app build: Nitro bakes its static-asset
# manifest at build time, so files added to .output/public afterwards 404.
# Served at /storybook/ (trailing slash required).
RUN STORYBOOK_DISABLE_TELEMETRY=1 pnpm run build-storybook --output-dir public/storybook
RUN pnpm run build

# --- runtime ---
FROM node:22-alpine
WORKDIR /app
# TanStack Start / Nitro outputs a self-contained server in .output/
COPY --from=builder /app/.output ./.output
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
