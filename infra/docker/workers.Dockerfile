# Helio workers — Temporal worker process. The workflow sandbox bundles
# from source at startup, so this image keeps the workspace install
# (no single-file bundle). Build context: repository root.

FROM node:24-slim AS base
WORKDIR /repo
# pnpm is this image's runtime launcher, so corepack's store must be
# baked at build time somewhere every user can read — and the runtime
# must never fall back to a network download. (The default store lives
# under the *build* user's home; after USER helio the runtime user has
# no home, and a base-image corepack bump turned that into a startup
# crash loop: EACCES mkdir /home/helio/.cache.)
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
    && groupadd --system helio && useradd --system --gid helio helio
COPY . .
RUN pnpm install --frozen-lockfile && chmod -R a+rX "$COREPACK_HOME"
RUN pnpm --filter @helio/db build
ENV NODE_ENV=production
# Release identity baked at build time; surfaced on /healthz and in the UI.
ARG HELIO_VERSION
ARG HELIO_COMMIT
ENV HELIO_VERSION=$HELIO_VERSION \
    HELIO_COMMIT=$HELIO_COMMIT
USER helio
# Deterministic launch: the pinned pnpm is already in COREPACK_HOME; a
# missing cache must fail loudly, never re-download at startup.
ENV COREPACK_ENABLE_NETWORK=0
CMD ["pnpm", "--filter", "@helio/workers", "start"]
