# Helio migrate — a one-shot job image for schema deploys, seeding, and
# vault-key rotation. Used by `helio install/update` (compose), the Helm
# pre-upgrade hook, and operators directly:
#
#   docker run --rm -e DATABASE_ADMIN_URL=… ghcr.io/achref-soua/helio-migrate <cmd>
#
# Commands: deploy (default) | seed | status | rotate
# Build context: repository root.

FROM node:24-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# The generated client ships in the image so seed/rotate run cold.
RUN pnpm --filter @helio/db build
# Dev deps stay in: the prisma CLI and tsx ARE this image's runtime.
RUN pnpm --filter @helio/db deploy --legacy /deploy

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Release identity baked at build time; surfaced in logs.
ARG HELIO_VERSION
ARG HELIO_COMMIT
ENV HELIO_VERSION=$HELIO_VERSION \
    HELIO_COMMIT=$HELIO_COMMIT
RUN groupadd --system helio && useradd --system --gid helio helio \
    && apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=helio:helio /deploy ./
COPY --chown=helio:helio infra/docker/migrate/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER helio
ENTRYPOINT ["/entrypoint.sh"]
CMD ["deploy"]
