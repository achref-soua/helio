# Helio in-app update sidecar — multi-stage, runs as root by necessity (it
# holds the Docker socket; that is the whole point of isolating it here).
# Build context: repository root.
#
#   stage 1  compile the standalone `helio` CLI to a musl binary (the final
#            image is Alpine), with the release version baked in.
#   stage 2  docker:cli (docker + compose) + the binary + updater.sh.

FROM oven/bun:1 AS build
WORKDIR /src
# The CLI is dependency-free and import-standalone, so its own tree is the
# entire build input — no workspace install needed.
COPY apps/cli/ ./apps/cli/
ARG HELIO_VERSION=dev
RUN bun build --compile --minify \
    --target=bun-linux-x64-musl \
    --define "process.env.HELIO_CLI_VERSION=\"${HELIO_VERSION}\"" \
    apps/cli/src/main.ts --outfile /helio

FROM docker:28-cli AS runner
# docker:cli ships the compose plugin in recent tags; install it explicitly
# so a base-image change can never silently break `docker compose`. The bun
# single-file binary is musl-linked but still needs the C++ runtime.
RUN apk add --no-cache docker-cli-compose libstdc++ libgcc
# Release identity, surfaced in logs and baked into the embedded CLI.
ARG HELIO_VERSION=dev
ARG HELIO_COMMIT=
ENV HELIO_VERSION=$HELIO_VERSION \
    HELIO_COMMIT=$HELIO_COMMIT \
    HELIO_CLI_VERSION=$HELIO_VERSION
COPY --from=build /helio /usr/local/bin/helio
COPY infra/docker/updater/updater.sh /usr/local/bin/updater.sh
RUN chmod +x /usr/local/bin/helio /usr/local/bin/updater.sh
ENTRYPOINT ["/usr/local/bin/updater.sh"]
CMD ["serve"]
