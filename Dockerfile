# --- builder ---
FROM node:22-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Install deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
ARG VITE_LANGFUSE_PUBLIC_KEY
ARG VITE_LANGFUSE_BASE_URL
RUN pnpm run build

# --- runtime ---
FROM node:22-alpine
WORKDIR /app
# TanStack Start / Nitro outputs a self-contained server in .output/
COPY --from=builder /app/.output ./.output
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
