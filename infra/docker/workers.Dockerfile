# Helio workers — Temporal worker process. The workflow sandbox bundles
# from source at startup, so this image keeps the workspace install
# (no single-file bundle). Build context: repository root.

FROM node:24-slim AS base
WORKDIR /repo
RUN corepack enable \
    && groupadd --system helio && useradd --system --gid helio helio
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @helio/db build
ENV NODE_ENV=production
USER helio
CMD ["pnpm", "--filter", "@helio/workers", "start"]
