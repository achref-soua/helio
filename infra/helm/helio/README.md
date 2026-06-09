# Helio Helm chart

Deploy [Helio](https://github.com/achref-soua/helio) — the open-source,
self-hostable, AI-native marketing-automation platform — to Kubernetes.

The chart deploys Helio's six application services (`web`, `api`, `ingest`,
`tracking`, `workers`, `intelligence`) with health probes, resource requests,
a shared config/secret, optional Ingress and autoscaling, and — for
evaluation — optional in-cluster Postgres (with pgvector) and Redis.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.12+ (Helm 4 supported)
- A container registry with the Helio images (the release pipeline publishes
  `ghcr.io/achref-soua/helio-<service>` on every tagged release)
- For the full event/analytics loop: reachable ClickHouse, Redpanda, Temporal,
  and S3/MinIO (deploy from their official charts and point this chart at them)

## Install

```bash
# From a clone of the repo:
helm install helio ./infra/helm/helio \
  --namespace helio --create-namespace \
  --set secrets.data.BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --set secrets.data.TRACKING_SECRET="$(openssl rand -hex 24)" \
  --set secrets.data.UNSUBSCRIBE_SECRET="$(openssl rand -hex 24)" \
  --set secrets.data.DATABASE_URL="postgresql://helio_app:helio@helio-postgresql:5432/helio" \
  --set secrets.data.DATABASE_ADMIN_URL="postgresql://helio:helio@helio-postgresql:5432/helio" \
  --set secrets.data.REDIS_URL="redis://helio-redis:6379"
```

Render the manifests without installing to review them first:

```bash
helm template helio ./infra/helm/helio | less
```

## Database migrations

The migrations create the row-level-security roles (`helio_app`) the app
connects as, so they must run **before** the app can serve traffic. They're a
Helm pre-install/pre-upgrade hook, disabled by default because they need an
image that contains the `@helio/db` package and the Prisma CLI:

```bash
helm upgrade --install helio ./infra/helm/helio \
  --set migrations.enabled=true \
  --set migrations.image=<image-with-@helio/db>
```

## Production guidance

- **Secrets** — don't put real secrets in a values file. Create a Secret
  out-of-band and set `secrets.existingSecret=<name>`; the chart then skips
  rendering its own.
- **Datastores** — disable the bundled `postgresql.enabled` / `redis.enabled`
  and point `secrets.data.DATABASE_URL` / `REDIS_URL` (and `config.*` for
  ClickHouse/Redpanda/Temporal) at managed services. The in-cluster Postgres
  and Redis are single-replica conveniences for evaluation, not HA.
- **Ingress** — set `ingress.enabled=true` and adjust `ingress.hosts` to route
  the dashboard, gateway, and tracking endpoints; add `ingress.tls` for certs.
- **Autoscaling** — set `autoscaling.enabled=true` to add HPAs for the listed
  `autoscaling.services` (the static `replicas` are then ignored for those).

## Key values

| Key                             | Default                   | Description                                            |
| ------------------------------- | ------------------------- | ------------------------------------------------------ |
| `image.registry` / `.namespace` | `ghcr.io` / `achref-soua` | Where the `helio-<service>` images live.               |
| `image.tag`                     | chart `appVersion`        | Image tag for every service.                           |
| `config`                        | see `values.yaml`         | Non-secret env, rendered into a ConfigMap.             |
| `secrets.existingSecret`        | `""`                      | Use an out-of-band Secret instead of rendering one.    |
| `secrets.data.*`                | `""`                      | Secret env (auth, DB, Redis, tracking, LLM key).       |
| `services.<name>.replicas`      | `1`–`2`                   | Per-service replica count.                             |
| `services.<name>.resources`     | `resources`               | Per-service compute override.                          |
| `ingress.enabled` / `.hosts`    | `false`                   | Public routing for web / api / tracking.               |
| `autoscaling.enabled`           | `false`                   | HPAs for `autoscaling.services`.                       |
| `postgresql.enabled`            | `true`                    | Bundled in-cluster Postgres (pgvector) for evaluation. |
| `redis.enabled`                 | `true`                    | Bundled in-cluster Redis for evaluation.               |
| `migrations.enabled` / `.image` | `false`                   | Run schema migrations as a pre-install/upgrade hook.   |

The complete, commented surface is [`values.yaml`](./values.yaml).

## Uninstall

```bash
helm uninstall helio --namespace helio
```

PersistentVolumeClaims from the bundled datastores are retained by default —
delete them explicitly if you want the data gone.
