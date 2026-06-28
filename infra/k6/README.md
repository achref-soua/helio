# Load tests (k6)

Performance tests for the hot paths, against the targets in the root
[CLAUDE.md §7](../../CLAUDE.md): **ingestion sustained ≥ 5k events/s** and
**API reads p95 < 150 ms** on a modest box.

## Prerequisites

```bash
task up:full                      # Postgres, Redis, ClickHouse, Redpanda
task db:seed                      # provisions the demo write key
task ch:migrate                   # creates the ClickHouse events table

# Run a production build of ingestion (not `dev`/tsx) for a representative
# number, and raise the per-workspace rate limit so the firehose measures
# raw capacity rather than the load shedder (see note below):
pnpm --filter @helio/ingest build
INGEST_RATE_LIMIT_MAX=100000000 node apps/ingest/dist/server.mjs   # :4100
```

Install k6, or run it from Docker (`--network host` so it reaches `:4100`):
`docker run --rm --network host -v "$PWD/infra/k6:/scripts:ro" grafana/k6 run /scripts/ingest.js`.

> **Rate limit vs. capacity.** Ingestion rate-limits per workspace
> (`INGEST_RATE_LIMIT_MAX`, default **600 / 60 s** = ~100 events/s for one
> workspace). A single-workspace firehose therefore gets `429 + Retry-After`
> for almost every request — correct load shedding, but the default profile's
> "accept > 99 %" threshold can only pass with the limit raised (above) or
> the load spread across many workspaces. Lift it to measure raw throughput.

## Ingestion firehose

```bash
k6 run infra/k6/ingest.js
# tune: RATE (batches/s), BATCH_SIZE, VUS, DURATION
RATE=800 BATCH_SIZE=10 k6 run infra/k6/ingest.js   # ~8k events/s
```

The default profile drives 600 batches/s × 10 events = **6 000 events/s**
for one minute and asserts: batch accept rate > 99 %, HTTP p95 < 150 ms,
error rate < 1 %.

## Recording results

Capture the summary into the table below after a run on the reference box
(describe the hardware). Re-run when the ingestion or sink path changes.

Reference box: WSL2, 20 vCPU, 15 GiB RAM, with k6, the ingest process,
Redpanda, ClickHouse, Postgres and Redis **all co-located on one host**
(rate limit lifted; production separates these and runs multiple ingest
replicas, so these numbers understate a real deployment).

| Date       | Hardware            | Offered  | Sustained events/s | accept | p95    | errors |
| ---------- | ------------------- | -------- | ------------------ | ------ | ------ | ------ |
| 2026-06-28 | WSL2 20 vCPU 15 GiB | 6 000/s  | 6 063              | 100 %  | 5.4 ms | 0 %    |
| 2026-06-28 | WSL2 20 vCPU 15 GiB | 15 000/s | 15 435             | 100 %  | 23 ms  | 0 %    |
| 2026-06-28 | WSL2 20 vCPU 15 GiB | 20 000/s | 20 259             | 100 %  | 81 ms  | 0 %    |
| 2026-06-28 | WSL2 20 vCPU 15 GiB | 30 000/s | 23 586 (plateau)   | 100 %  | 336 ms | 0 %    |

Sustains **~20 000 events/s at p95 81 ms — 4× the ≥ 5 000 events/s budget**,
within the < 150 ms target; a single ingest process saturates at ~23.5k
events/s (offering 30k, k6 drops the surplus). End to end, 3.0 M events
drained through Redpanda into ClickHouse with the consumer group at **zero
lag**. Re-run when the ingestion or sink path changes; the threshold is
committed so regressions fail the run.
