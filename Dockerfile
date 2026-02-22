# --- builder ---
FROM node:22-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

# Install deps (skip postinstall that would try to run uv)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY . .
RUN pnpm run build

# --- runtime ---
FROM node:22-alpine
WORKDIR /app
# TanStack Start / Nitro outputs a self-contained server in .output/
COPY --from=builder /app/.output ./.output
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
