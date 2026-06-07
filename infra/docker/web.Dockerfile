# Helio dashboard — multi-stage, non-root, standalone output.
# Build context: repository root.

FROM node:24-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# Prisma client must exist before Next compiles the workspace packages.
RUN pnpm --filter @helio/db build
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time env: validated again with real values at runtime.
RUN BETTER_AUTH_SECRET=build-time-placeholder-secret-0000 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    DATABASE_ADMIN_URL=postgresql://build:build@localhost:5432/build \
    pnpm --filter @helio/web build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system helio && useradd --system --gid helio helio \
    && apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=helio:helio /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=helio:helio /repo/apps/web/.next/static ./apps/web/.next/static
USER helio
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD curl -fsS http://localhost:3000/api/healthz || exit 1
CMD ["node", "apps/web/server.js"]
