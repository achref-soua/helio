# Helio backup sidecar — scheduled local pg_dump backups with metadata
# rows the dashboard can read, plus run-now/restore entrypoints for the
# helio CLI. postgres:16-alpine pins pg_dump to the bundled server major
# (the bundle build asserts this pairing).
# Build context: repository root.

FROM postgres:16-alpine
RUN apk add --no-cache openssl coreutils
# Release identity baked at build time; surfaced in backup metadata.
ARG HELIO_VERSION
ARG HELIO_COMMIT
ENV HELIO_VERSION=$HELIO_VERSION \
    HELIO_COMMIT=$HELIO_COMMIT
COPY infra/docker/backup/backup.sh /backup.sh
RUN chmod +x /backup.sh && mkdir -p /backups && chown postgres:postgres /backups
# Starts as root only to chown the bind-mounted /backups (host-owned on
# Linux), then immediately drops to postgres via su-exec — see backup.sh.
ENTRYPOINT ["/backup.sh"]
CMD ["daemon"]
