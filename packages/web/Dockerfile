# --- builder ---
FROM node:22-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Copy lockfile and workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy packages
COPY packages/shared packages/shared
COPY packages/web packages/web

# Install deps
RUN pnpm install --frozen-lockfile

# Build web package
RUN pnpm --filter @cofacts-ai/web build

# --- runtime ---
FROM node:22-alpine
WORKDIR /app
# TanStack Start / Nitro outputs a self-contained server in .output/
COPY --from=builder /app/packages/web/.output ./.output
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
