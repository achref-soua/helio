import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createShutdown } from '../src/shutdown';

describe('createShutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs tasks in order and exits 0', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const handler = createShutdown({
      tasks: [
        { name: 'http', run: () => order.push('http') },
        { name: 'db', run: async () => void order.push('db') },
      ],
      exit,
    });
    await handler('SIGTERM');
    expect(order).toEqual(['http', 'db']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('a failing task is logged and never blocks the rest', async () => {
    const order: string[] = [];
    const logs: string[] = [];
    const handler = createShutdown({
      tasks: [
        {
          name: 'bus',
          run: () => {
            throw new Error('broker gone');
          },
        },
        { name: 'db', run: () => order.push('db') },
      ],
      log: (message) => logs.push(message),
      exit: vi.fn(),
    });
    await handler('SIGTERM');
    expect(order).toEqual(['db']);
    expect(logs.some((line) => line.includes('bus failed to close: broker gone'))).toBe(true);
  });

  it('ignores a second signal while already draining', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const handler = createShutdown({ tasks: [{ name: 'once', run }], exit });
    await Promise.all([handler('SIGTERM'), handler('SIGINT')]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('force-exits 1 when the drain outlives the deadline', async () => {
    const exit = vi.fn();
    const handler = createShutdown({
      tasks: [{ name: 'hung', run: () => new Promise(() => {}) }],
      timeoutMs: 5_000,
      exit,
    });
    const draining = handler('SIGTERM');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exit).toHaveBeenCalledWith(1);
    // The hung task never resolves; the promise is intentionally left behind
    // (the real process is gone by now).
    void draining;
  });

  it('reports the signal and each closed task', async () => {
    const logs: string[] = [];
    const handler = createShutdown({
      tasks: [{ name: 'redis', run: () => undefined }],
      log: (message) => logs.push(message),
      exit: vi.fn(),
    });
    await handler('SIGINT');
    expect(logs[0]).toContain('SIGINT received');
    expect(logs).toContainEqual('redis closed');
  });
});
