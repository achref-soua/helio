# ADR-0018: One-command install — the helio CLI and release bundles

- Status: accepted
- Date: 2026-06-11

## Context

v1 required a git clone, pnpm, Taskfile, and hand-edited env files —
fine for engineers, a wall for the marketing teams Helio is for. v2's
brief: install on Windows, macOS, Linux, and servers/VMs with one
command, no repository, with updates, backups, and key rotation as
first-class operations. The maintainer is one person on a 15 GB WSL2
box, and GitHub Actions had been disabled to avoid CI noise.

## Decision

A TypeScript CLI (`apps/cli`, zero runtime dependencies) compiled to
single-file binaries for five targets with `bun build --compile` —
cross-compiled from one machine, proven locally. `install.sh` /
`install.ps1` one-liners fetch the right binary and hand over to
`helio install`. Installations live in `~/.helio`: a compose file with
image tags **pinned to one release** (built by
`scripts/release/build-bundle.ts`, checksum-manifested, validated with
`docker compose config`), and a `.env` generated from the bundle's
marker template (same-named markers share values, keeping connection
strings consistent). Postgres and Redis stay unexposed to the host.

Updates are explicit and reversible-by-backup: `helio update` refuses
downgrades, takes a pre-update backup (Prisma has no down-migrations —
the database backup _is_ the rollback), archives the old compose,
appends new env keys without touching user edits, then migrates and
verifies health. One-shot jobs (migrate/seed/status/rotate) run in a
dedicated `helio-migrate` image so neither the installer nor Helm needs
a source checkout.

Releases re-enable Actions with exactly **one workflow**, triggered
only by `v*` tags: build/scan/push the seven images, compile the five
binaries, build the bundle, and upload everything to the release the
maintainer already created with `gh release create` (which is what
pushes the tag). No push/PR jobs, no schedules — day-to-day CI remains
the local `task verify` gate, and `task release:*` reproduces every
artifact locally if Actions is ever off again.

Considered and rejected: Go (a second language for one tool), plain
shell scripts (no credible Windows/update/backup story), a Tauri
desktop launcher (cannot be cross-built from WSL2; the dashboard PWA
covers the "app with the logo" need), and `:latest` tags (updates must
be deliberate, backed-up steps).

## Consequences

- A clean machine goes from nothing to a running, seeded Helio with one
  command; the same flow drives the owner's Windows release test.
- Binaries are ~60–95 MB (Bun embeds its runtime) — acceptable for an
  installer fetched once.
- The bundle pins images, so installs are reproducible and `helio
update` is the only path that changes versions.
- Everything Actions does is reproducible locally; the repository stays
  silent except when a release tag is pushed.
