import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { waitForHttpOk } from '../src/lib/health';
import {
  helioHome,
  installPaths,
  isInstalled,
  readManifest,
  writeManifest,
} from '../src/lib/state';

describe('installation state', () => {
  it('honors HELIO_HOME and defaults to ~/.helio', () => {
    expect(helioHome({ HELIO_HOME: '/srv/helio' })).toBe('/srv/helio');
    expect(helioHome({})).toContain('.helio');
  });

  it('round-trips the manifest and reports installed-ness', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'helio-home-'));
    const paths = installPaths(home);
    expect(isInstalled(paths)).toBe(false);
    expect(readManifest(paths)).toBeNull();

    writeManifest(paths, { name: 'helio', version: 'v2.0.0', files: {} });
    const manifest = readManifest(paths)!;
    expect(manifest.version).toBe('v2.0.0');
    expect(manifest.installedAt).toBeTruthy();
  });
});

describe('waitForHttpOk', () => {
  it('returns true as soon as the endpoint answers 2xx', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await expect(
      waitForHttpOk('http://localhost:3000/api/healthz', {
        fetchImpl,
        intervalMs: 1,
        timeoutMs: 1_000,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up at the deadline', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    await expect(
      waitForHttpOk('http://localhost:3000/api/healthz', {
        fetchImpl,
        intervalMs: 5,
        timeoutMs: 30,
      }),
    ).resolves.toBe(false);
  });
});
