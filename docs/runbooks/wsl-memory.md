# Runbook: WSL2 memory (avoiding OOM crashes)

This box runs Helio's stack alongside a second project's containers. WSL2
defaults to ~50% of host RAM with a small swap, and the combination of
the Helio `full` profile (Postgres, Redis, Mailpit, ClickHouse, Redpanda,
Temporal ×2, MinIO), Testcontainers, Next.js builds, and the parallel
project can exhaust it — exhausted swap is what kills the WSL VM.

## Durable fix — raise the WSL caps (host side, Windows)

Edit `C:\Users\<you>\.wslconfig` (create it if missing), then
`wsl --shutdown` from PowerShell to apply:

```ini
[wsl2]
memory=24GB        # raise toward your host RAM; 24–28GB on a 32GB host
swap=16GB          # generous swap is the safety net against OOM
swapfile=C:\\wsl-swap.vhdx
processors=8
```

After `wsl --shutdown`, reopen the terminal and re-`task up`.

## In-session discipline (when RAM is tight)

- The e2e and most integration suites only need the **core** profile
  (Postgres, Redis, Mailpit). Stop the heavy services you aren't using:

  ```bash
  docker stop helio-clickhouse-1 helio-redpanda-1 \
    helio-temporal-1 helio-temporal-ui-1 helio-minio-1
  ```

  Integration tests (db, ingest, workers, intelligence) spin up their own
  ephemeral Testcontainers, so the persistent `full` stack need not run
  during `pnpm turbo run test`.

- Don't run `task verify` + `pnpm build` + `task verify:e2e` concurrently;
  run tests serially: `pnpm turbo run test --concurrency=1`.
- Kill stray dev servers between runs: `pkill -f next-server`.
- Check headroom before a heavy run: `free -h` (watch the **Swap** line —
  if it's near full, free memory first).
