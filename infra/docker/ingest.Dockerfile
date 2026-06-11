# Helio ingestion — esbuild single-file bundle on a slim runtime.
# Build context: repository root.

FROM node:24-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @helio/db build
RUN pnpm --filter @helio/ingest build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Release identity baked at build time; surfaced on /healthz and in the UI.
ARG HELIO_VERSION
ARG HELIO_COMMIT
ENV HELIO_VERSION=$HELIO_VERSION \
    HELIO_COMMIT=$HELIO_COMMIT
RUN groupadd --system helio && useradd --system --gid helio helio \
    && apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=helio:helio /repo/apps/ingest/dist/server.mjs ./server.mjs
COPY --from=builder --chown=helio:helio /repo/apps/ingest/clickhouse ./clickhouse
USER helio
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS http://localhost:4100/healthz || exit 1
CMD ["node", "server.mjs"]
