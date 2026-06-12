import type { FetchLike } from './bundle';

/** Poll a URL until it answers 2xx or the deadline passes. */
export async function waitForHttpOk(
  url: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    fetchImpl?: FetchLike;
    onAttempt?: (attempt: number) => void;
  } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 3_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    options.onAttempt?.(attempt);
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() + intervalMs > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
