# Load tests (k6)

Performance tests for the hot paths, against the targets in the root
[CLAUDE.md §7](../../CLAUDE.md): **ingestion sustained ≥ 5k events/s** and
**API reads p95 < 150 ms** on a modest box.

## Prerequisites

```bash
task up:full                      # Postgres, Redis, ClickHouse, Redpanda
task db:seed                      # provisions the demo write key
pnpm --filter @helio/ingest dev   # ingestion on :4100
```

Install k6: <https://grafana.com/docs/k6/latest/set-up/install-k6/>.

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

| Date      | Hardware | Target                       | Result (p95 latency · accept rate · throughput)       |
| --------- | -------- | ---------------------------- | ----------------------------------------------------- |
| _pending_ | —        | 6 000 events/s, p95 < 150 ms | run `k6 run infra/k6/ingest.js` and paste the summary |

> Results are pending a run on reference hardware; the harness and budgets
> are in place so the number is one command away and regressions show up
> against a committed threshold.
