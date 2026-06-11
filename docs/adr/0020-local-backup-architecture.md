# ADR-0020: Local backups via a sidecar with database-visible metadata

- Status: accepted
- Date: 2026-06-11

## Context

v2 requires "a smart backup system, created and hosted locally" that
non-technical operators can see and trust: scheduled, visible in the
dashboard, restorable, with a pre-update safety net. The app containers
do not ship `pg_dump`, the stack must work identically on Linux, macOS,
and Windows (Docker Desktop), and Prisma has no down-migrations — so a
database backup is also the only honest rollback for `helio update`.

## Decision

A dedicated `helio-backup` sidecar (postgres:16-alpine — pinning
`pg_dump` to the bundled server major, asserted at bundle build) runs in
every install. A sleep-loop daemon (no cron to babysit) takes the
nightly dump and polls a `backup_request` table every 15 seconds, which
is how the dashboard's _Back up now_ works — no docker socket, no
sidecar HTTP server. Dumps are `pg_dump -Fc`, written atomically,
sha256-summed, optionally passphrase-encrypted (openssl AES-256-CBC,
PBKDF2), and recorded in an instance-level `backup_run` table the
dashboard reads. Those tables use ENABLE (not FORCE) row-level
security: the sidecar writes on the admin role it already needs for
`pg_dump`, while the app role gets exactly SELECT on runs and INSERT on
requests.

Files land on a bind mount (`~/.helio/backups`) so operators can see
them in their file manager; the dashboard mounts the folder read-only
and streams downloads with the filename taken solely from the database
row. The sidecar starts as root only to chown the host-owned mount,
then drops to `postgres` via su-exec — the live test on Linux proved
both the failure path (a FAILED row was recorded) and the fix.

Restores are CLI-only and destructive-by-confirmation (`helio restore`,
typed word): checksum verify → optional decrypt → `pg_restore --clean`
→ `prisma migrate deploy` (rolling older dumps forward) → restart →
health check. `helio backup` also snapshots `.env` beside the dumps,
because a dump without the matching `HELIO_ENCRYPTION_KEY` cannot
reveal stored credentials — that property is the vault working as
intended, and the snapshot is how restores keep working.

ClickHouse events are documented as re-derivable analytics with a
manual `BACKUP DATABASE` appendix, not part of the scheduled loop.

## Consequences

- Backups work identically across OSes and in the core profile (no
  Temporal/workers dependency), survive the stack being down (the
  sidecar is independent), and surface failures in the dashboard.
- One more image to publish; it is alpine-small and shares the release
  pipeline.
- The retention policy is count-based (14 + the 5 newest pre-update),
  deliberately simple to reason about; operators wanting offsite copies
  sync the folder with any tool they already trust.
