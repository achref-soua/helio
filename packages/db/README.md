# @helio/db

Prisma 7 schema, migrations, tenant-scoped client, and seed data for Helio's transactional store (PostgreSQL 16 + pgvector).

## Tenant isolation model

Isolation is enforced **by Postgres row-level security**, not by query discipline:

- Runtime traffic connects as **`helio_app`** — a role without `BYPASSRLS`. Policies on every tenant-scoped table key on the transaction-local `app.org_id` setting.
- `forTenant(prisma, orgId)` returns a client whose every operation runs inside a transaction that sets `app.org_id` first. No tenant context → no rows.
- Migrations and seeds connect with the admin URL (table owner, bypasses RLS).

```ts
import { createPrismaClient, forTenant } from '@helio/db';

const prisma = createPrismaClient(env.DATABASE_URL); // helio_app role
const tenant = forTenant(prisma, organizationId);
await tenant.workspace.findMany(); // only this org's rows, guaranteed by Postgres
```

The integration suite (`tests/rls.integration.test.ts`) proves the guarantees against a real Postgres container: no context → empty; cross-tenant reads by id → null; cross-tenant writes/updates/deletes → rejected.

## Commands

| Command           | Purpose                                        |
| ----------------- | ---------------------------------------------- |
| `pnpm db:migrate` | create/apply a migration in dev                |
| `pnpm db:deploy`  | apply committed migrations (CI/prod)           |
| `pnpm db:seed`    | idempotent demo data (Acme / Growth workspace) |
| `pnpm db:studio`  | Prisma Studio                                  |
| `pnpm test`       | RLS integration suite (needs Docker)           |

Environment: `DATABASE_URL` (app role) and `DATABASE_ADMIN_URL` (migrations/seed) — see the root `.env.example`.

The generated client lands in `src/generated/` (git-ignored); `prisma generate` runs automatically before typecheck/test.
