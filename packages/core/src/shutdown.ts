export interface ShutdownTask {
  name: string;
  run: () => Promise<unknown> | unknown;
}

export interface ShutdownOptions {
  /** Cleanup steps, run in order: stop intake first, release stores last. */
  tasks: ShutdownTask[];
  /** Hard deadline before force-exit — stay inside the pod grace period. */
  timeoutMs?: number;
  log?: (message: string) => void;
  /** Injectable for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

/**
 * Build an idempotent drain handler: runs every task in order (a failing
 * task is logged and skipped, never blocks the rest), then exits 0. A
 * watchdog force-exits 1 if the drain outlives the deadline, so a hung
 * connection can never outlive Kubernetes' SIGTERM grace window.
 */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  const log = options.log ?? (() => {});
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? 10_000;
  let draining = false;

  return async (signal: string) => {
    if (draining) return;
    draining = true;
    log(`${signal} received, draining`);

    const watchdog = setTimeout(() => {
      log(`drain exceeded ${timeoutMs}ms, forcing exit`);
      exit(1);
    }, timeoutMs);
    watchdog.unref?.();

    for (const task of options.tasks) {
      try {
        await task.run();
        log(`${task.name} closed`);
      } catch (error) {
        log(`${task.name} failed to close: ${error instanceof Error ? error.message : error}`);
      }
    }
    clearTimeout(watchdog);
    exit(0);
  };
}

/** Wire the drain handler to SIGTERM/SIGINT (what Kubernetes and a ^C send). */
export function registerShutdown(options: ShutdownOptions): void {
  const handler = createShutdown(options);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void handler(signal));
  }
}
