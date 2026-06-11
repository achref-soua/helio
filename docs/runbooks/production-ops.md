# Production operations

Day-2 procedures for a self-hosted Helio. Topology and first-install steps
live in the [production deployment guide](../../apps/docs/content/docs/production.mdx);
this runbook is what you do after it's live.

## What to back up (and what not to)

| Store          | Holds                                             | Backup                                                                    |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| **PostgreSQL** | Tenants, contacts, journeys, templates, audit log | Yes — daily base + PITR/WAL. The one store you cannot lose.               |
| **ClickHouse** | Behavioral events, opens/clicks                   | Yes — events are source data (they drive segments, scoring, attribution). |
| **Redis**      | Rate-limit counters, idempotency replay, cache    | No — everything in it expires or rebuilds.                                |
| **MinIO/S3**   | Uploaded assets, exports                          | Versioning/replication on the bucket.                                     |
| **Temporal**   | In-flight journey state (its own Postgres/MySQL)  | Yes if self-hosting Temporal — its datastore is journey durability.       |

### PostgreSQL

Managed Postgres: enable automated backups + point-in-time recovery and set
the retention to your compliance window. Self-managed:

```bash
# Nightly logical dump (the admin role owns the schema)
# Bundle installs (helio CLI): backups are automatic — the helio-backup
# sidecar takes a nightly pg_dump, Settings → Backups shows them, and
# `helio backup` / `helio restore <file>` run them by hand (ADR-0020).
# The manual command below is for source/managed deployments:
pg_dump "$DATABASE_ADMIN_URL" --format=custom --file=helio-$(date +%F).dump

# Restore into a fresh database, then verify RLS roles exist
pg_restore --clean --if-exists --no-owner -d "$DATABASE_ADMIN_URL" helio-<date>.dump
psql "$DATABASE_ADMIN_URL" -c "SELECT rolname FROM pg_roles WHERE rolname = 'helio_app';"
```

The `helio_app` role and every RLS policy are created by migrations, so a
restore followed by `prisma migrate deploy` is always safe to re-run.

### ClickHouse

```sql
-- One-off table backup to S3-compatible storage
BACKUP TABLE helio.events TO S3('https://<bucket-endpoint>/helio-ch/{ts}', '<key>', '<secret>');
RESTORE TABLE helio.events FROM S3('https://<bucket-endpoint>/helio-ch/<ts>', '<key>', '<secret>');
```

For continuous protection use scheduled `BACKUP ... INCREMENTAL` or
[clickhouse-backup](https://github.com/Altinity/clickhouse-backup). Losing
ClickHouse does not take the product down (analytics callers degrade to
"no data yet" by design) but loses history — treat it as data, not cache.

## Upgrades

1. **Snapshot Postgres first.** Prisma migrations are forward-only; the
   rollback story for a bad upgrade is "restore the snapshot".
2. Helm: `helm upgrade helio infra/helm/helio -f values-prod.yaml` — the
   migration Job runs as a pre-upgrade hook before new pods roll. Compose:
   `docker compose pull && docker compose run --rm <web> pnpm --filter @helio/db db:deploy && docker compose up -d`.
3. Rolling restarts are safe: every service drains on SIGTERM (stops
   intake, flushes the Kafka producer, disconnects consumer groups and
   stores) and Temporal journeys survive worker restarts by design —
   mid-flight runs resume, sends are deduplicated per contact.
4. Read the release notes for env-var additions; `.env.example` is the
   authoritative list and every variable lands there in the PR that adds it.

## Secret rotation

| Secret                             | Rotation effect                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`               | Invalidates sessions/tokens — every user signs in again. Rotate on compromise, not routinely. |
| `UNSUBSCRIBE_SECRET`               | Breaks unsubscribe links in **already-sent** mail. Avoid rotating; overlap windows if forced. |
| `TRACKING_SECRET`                  | Breaks click-redirect links in already-sent mail. Same caution.                               |
| `EMAIL_WEBHOOK_TOKEN`              | Safe to rotate any time — update the provider webhook URL in the same change.                 |
| `WEBHOOK_SIGNING_SECRET`           | Rotate together with consumers verifying `x-helio-signature`.                                 |
| Gateway API keys / SCIM token      | Re-mint in Settings (old credential dies on revoke); both store only hashes.                  |
| Postgres / ClickHouse / SMTP creds | Standard infra rotation; update the deployment Secret and roll pods.                          |

## Incident quick checks

Every service exposes `/healthz` (liveness) and `/readyz` (dependency
state); the dashboard's is `/api/healthz`.

| Symptom                       | Likely cause / behavior                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Analytics panes say "no data" | ClickHouse unreachable — by design the app keeps working; check `ingest /readyz`.                               |
| Journeys not advancing        | Temporal or workers down. Nothing is lost: runs resume where they stopped once workers return.                  |
| Events 5xx at ingestion       | Redpanda/Kafka down — the SDK retries; check broker health before the service.                                  |
| Mail not arriving             | Relay creds/quota, then SPF/DKIM/DMARC (Settings → Deliverability), then suppression status.                    |
| 429s on public endpoints      | Rate limits working as intended — budgets in [the docs](../../apps/docs/content/docs/security/rate-limits.mdx). |
| Stripe/Shopify webhooks 404   | Their env (`STRIPE_WEBHOOK_SECRET`, integration registration) is unset — disabled by design.                    |

## Data lifecycle

- **Erasure requests:** deleting a contact is a hard delete with cascades
  (list memberships, sends, runs). Audit rows persist without the contact.
- **Access requests:** per-contact "Export data (JSON)" bundles the profile,
  memberships, sends, runs, meetings, tasks, and recent events.
- **Suppression:** bounce/complaint webhooks and unsubscribes flip contact
  status; every send path honors it. Never bulk-reactivate suppressed
  contacts from an import — the importer refuses to resurrect them.
