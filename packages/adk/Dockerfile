# --- builder ---
FROM node:22-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Copy lockfile and workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy packages
COPY packages/shared packages/shared
COPY packages/adk packages/adk

# Install deps
RUN pnpm install --frozen-lockfile

# Build adk package
RUN pnpm --filter @cofacts-ai/adk build

# --- runtime ---
FROM node:22-alpine
RUN corepack enable pnpm
WORKDIR /app

# Copy production files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/adk/package.json packages/adk/

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy compiled files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist 2>/dev/null || true
COPY --from=builder /app/packages/shared/src ./packages/shared/src
COPY --from=builder /app/packages/adk/dist ./packages/adk/dist

EXPOSE 8000
ENV PORT=8000

CMD ["node", "packages/adk/dist/server.js"]
