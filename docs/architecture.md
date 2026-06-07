# Architecture

## System context (C4 level 1)

```mermaid
C4Context
  Person(operator, "Marketing operator", "Builds segments, journeys, campaigns")
  Person(visitor, "Tracked end-user", "Receives messages, generates events")
  System(helio, "Helio", "Open-source growth platform")
  System_Ext(smtp, "Email relay", "SMTP / SES / Postmark / Resend")
  System_Ext(llm, "LLM provider", "Anthropic / OpenAI / local (Phase 3)")
  Rel(operator, helio, "Operates via dashboard & API")
  Rel(visitor, helio, "Events via tracking SDK; clicks/opens")
  Rel(helio, smtp, "Sends mail")
  Rel(helio, llm, "Copilot, generation, scoring")
```

## Containers (C4 level 2)

```mermaid
C4Container
  Container(web, "Dashboard", "Next.js 16", "UI, Better-Auth kernel, tRPC BFF")
  Container(api, "Gateway", "Hono", "Public REST/OpenAPI, webhooks")
  Container(intel, "Intelligence", "FastAPI/uv", "Copilot, scoring, MCP (later phases)")
  Container(workers, "Journey workers", "TS + Temporal", "Durable journeys (Phase 1)")
  ContainerDb(pg, "PostgreSQL 16", "pgvector + RLS", "Transactional source of truth")
  ContainerDb(ch, "ClickHouse", "", "Event analytics (Phase 1)")
  ContainerDb(redis, "Redis", "", "Rate limits, idempotency, cache")
  ContainerQueue(rp, "Redpanda", "Kafka API", "Event backbone (Phase 1)")
  ContainerDb(minio, "MinIO/S3", "", "Assets & exports")
  Rel(web, pg, "Prisma: admin (auth kernel) + RLS app role (domain)")
  Rel(api, pg, "RLS app role only")
  Rel(api, redis, "rate limit / idempotency")
  Rel(workers, pg, "RLS app role")
  Rel(workers, rp, "consume events")
  Rel(intel, ch, "feature reads (Phase 3)")
```

## Trust boundaries

- **Auth kernel** (inside `apps/web`, admin connection): identity, sessions, memberships. Identity tables are revoked from the app role (ADR-0004).
- **Domain plane** (`helio_app` role, RLS-forced): everything tenant-owned. `forTenant()` is the only path (ADR-0003).
- **Public edge** (`apps/api`): bearer-authenticated, rate-limited, idempotent, problem+json (ADR-0008).

## Where things live

| Concern                                            | Location            |
| -------------------------------------------------- | ------------------- |
| Domain types, env validation, errors, ids, rbac    | `packages/core`     |
| Schema, migrations, tenant client                  | `packages/db`       |
| Design system + Storybook                          | `packages/ui`       |
| Lint/TS/test presets                               | `packages/config`   |
| Dashboard + auth + tRPC                            | `apps/web`          |
| Public REST gateway                                | `apps/api`          |
| Python intelligence plane                          | `apps/intelligence` |
| Compose profiles, Dockerfiles, observability stack | `infra/`            |

Decision log: [`docs/adr/`](./adr/).
