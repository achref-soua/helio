# Helio gateway — esbuild single-file bundle on a slim runtime.
# Build context: repository root.

FROM node:24-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @helio/db build
RUN pnpm --filter @helio/api build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system helio && useradd --system --gid helio helio \
    && apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=helio:helio /repo/apps/api/dist/server.mjs ./server.mjs
USER helio
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS http://localhost:4000/healthz || exit 1
CMD ["node", "server.mjs"]
