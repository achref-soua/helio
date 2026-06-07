# Runbook: local development

## Bring-up

```bash
task setup          # pnpm install + git hooks; uv sync runs per-service
task up             # Postgres(+pgvector), Redis, Mailpit — the core profile
task db:migrate     # apply migrations (admin role)
task db:seed        # demo org acme/growth
pnpm --filter @helio/web dev        # dashboard on :3000
pnpm --filter @helio/api dev        # gateway on :4000
pnpm --filter @helio/ingest dev     # event ingestion on :4100 (needs up:full)
pnpm --filter @helio/tracking dev   # open/click tracking on :4200 (needs up:full)
cd apps/intelligence && uv run uvicorn helio_intelligence.app:app --reload   # :8000
```

Heavier stacks: `task up:full` (ClickHouse, Redpanda, Temporal+UI, MinIO), `task up:observability` (collector, Prometheus :9090, Grafana :3001). `task down` stops every profile, keeping volumes.

The ingest service applies ClickHouse migrations at startup; `task ch:migrate` applies them standalone. Smoke-test ingestion with the seeded demo write key:

```bash
curl -s -X POST localhost:4100/v1/batch \
  -H 'content-type: application/json' \
  -H 'x-write-key: wk_demo_0000000000000000000000000' \
  -d '{"batch":[{"type":"track","event":"Smoke Test","anonymousId":"local-dev"}]}'
```

## Ports (defaults)

web 3000 · api 4000 · ingest 4100 · tracking 4200 · intelligence 8000 · Postgres 5432 · Redis 6379 · Mailpit SMTP 1025 / UI 8025 · ClickHouse 8123/9000 · Redpanda 19092 · Temporal 7233 / UI 8080 · MinIO 9002/9003 · Prometheus 9090 · Grafana 3001.

**Port collisions:** every port is overridable in `.env` (e.g. another stack owning 1025 ⇒ set `MAILPIT_SMTP_PORT=1026` and `SMTP_PORT=1026`).

## Email

All dev mail lands in Mailpit (`http://localhost:8025`). Nothing leaves the machine.

## E2E

```bash
cd apps/web && CI=1 pnpm test:e2e
```

⚠️ The suite **truncates the local database** and purges Mailpit at start (deterministic runs; guarded to localhost URLs). Don't point `DATABASE_ADMIN_URL` at anything you care about.

## WSL2 notes

The full profile wants headroom — if Docker gets OOM-killed, raise `memory=` in `~/.wslconfig` (host side) and `wsl --shutdown`. Mind neighbor projects' published ports (see collisions above).

## Database

`task db:studio` opens Prisma Studio (admin role). `task db:reset` wipes/recreates/reseeds after a typed confirmation. Two-role model: `DATABASE_ADMIN_URL` (migrations/seed/kernel) vs `DATABASE_URL` (`helio_app`, RLS-bound — what services use).
