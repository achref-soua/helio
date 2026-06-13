import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { waitForHttpOk } from '../src/lib/health';
import {
  alreadyInstalledMessage,
  helioHome,
  installPaths,
  isInstalled,
  keptDataMessage,
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

describe('reinstall guidance', () => {
  // The bug this guards: `uninstall` keeps ~/.helio by design, so the
  // directory still looks installed and a reinstall lands on this message.
  // It must point at all three real intents, not just "update".
  it('names the install directory and every recovery path', () => {
    const message = alreadyInstalledMessage('/home/jo/.helio');
    expect(message).toContain('/home/jo/.helio');
    expect(message).toContain('helio up');
    expect(message).toContain('helio update');
    expect(message).toContain('helio uninstall --purge-data');
  });

  it('tells a kept-data uninstall to use "up", not a reinstall', () => {
    const message = keptDataMessage('/home/jo/.helio');
    expect(message).toContain('/home/jo/.helio');
    expect(message).toContain('helio up');
    expect(message).toContain('--purge-data');
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

describe('readManifest resilience', () => {
  it('answers null for corrupt manifests instead of crashing', async () => {
    const { writeFileSync } = await import('node:fs');
    const home = mkdtempSync(path.join(tmpdir(), 'helio-home-'));
    const paths = installPaths(home);
    writeFileSync(paths.manifestFile, '{not json');
    expect(readManifest(paths)).toBeNull();
  });
});
