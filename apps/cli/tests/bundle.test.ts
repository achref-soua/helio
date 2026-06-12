import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  assetUrl,
  bundleAssetName,
  resolveLatestTag,
  sha256Hex,
  verifyBundle,
} from '../src/lib/bundle';

function bundleDir(files: Record<string, string>, manifestOverride?: object) {
  const dir = mkdtempSync(path.join(tmpdir(), 'helio-bundle-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content);
  }
  const manifest = manifestOverride ?? {
    name: 'helio',
    version: 'v2.0.0',
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, sha256Hex(Buffer.from(content))]),
    ),
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

describe('release resolution', () => {
  it('builds direct asset urls for explicit versions (no api call)', () => {
    expect(assetUrl('v2.0.0', bundleAssetName('v2.0.0'))).toBe(
      'https://github.com/achref-soua/helio/releases/download/v2.0.0/helio-bundle-v2.0.0.tar.gz',
    );
  });

  it('resolves latest through the github api', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v2.3.4' }), { status: 200 }));
    await expect(resolveLatestTag(fetchImpl)).resolves.toBe('v2.3.4');
  });

  it('explains rate-limit failures with the workaround', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    await expect(resolveLatestTag(fetchImpl)).rejects.toThrowError(/--version/);
  });
});

describe('verifyBundle', () => {
  const files = { 'docker-compose.yml': 'services: {}\n', '.env.template': 'A=1\n' };

  it('accepts a bundle whose files hash-match the manifest', () => {
    const manifest = verifyBundle(bundleDir(files));
    expect(manifest.version).toBe('v2.0.0');
  });

  it('rejects tampered files and foreign manifests', () => {
    const tampered = bundleDir(files);
    writeFileSync(path.join(tampered, 'docker-compose.yml'), 'services: {evil: {}}\n');
    expect(() => verifyBundle(tampered)).toThrowError(/checksum/);

    const foreign = bundleDir(files, { name: 'not-helio', version: 'v1', files: {} });
    expect(() => verifyBundle(foreign)).toThrowError(/not a helio bundle/);
  });

  it('rejects bundles missing a listed file', () => {
    const dir = bundleDir(files);
    const manifest = {
      name: 'helio',
      version: 'v2.0.0',
      files: { ...JSON.parse(JSON.stringify({})), ghost: '00' },
    };
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    expect(() => verifyBundle(dir)).toThrowError(/missing ghost/);
  });
});

describe('downloadAsset and extractTarGz', () => {
  it('writes the asset bytes and extracts a real tarball', async () => {
    const { downloadAsset, extractTarGz } = await import('../src/lib/bundle');
    const { spawnSync } = await import('node:child_process');
    const { mkdtempSync, readFileSync: read, writeFileSync: write } = await import('node:fs');
    const os = await import('node:os');

    const src = mkdtempSync(path.join(os.tmpdir(), 'helio-tar-src-'));
    write(path.join(src, 'hello.txt'), 'hi');
    const archive = path.join(src, 'pkg.tar.gz');
    spawnSync('tar', ['-czf', archive, '-C', src, 'hello.txt']);

    const fetchImpl = vi.fn().mockResolvedValue(new Response(read(archive), { status: 200 }));
    const dest = path.join(mkdtempSync(path.join(os.tmpdir(), 'helio-dl-')), 'pkg.tar.gz');
    await downloadAsset('https://example.test/pkg.tar.gz', dest, fetchImpl);

    const out = mkdtempSync(path.join(os.tmpdir(), 'helio-extract-'));
    extractTarGz(dest, out);
    expect(read(path.join(out, 'hello.txt'), 'utf8')).toBe('hi');
  });

  it('throws on failed downloads and corrupt archives', async () => {
    const { downloadAsset, extractTarGz } = await import('../src/lib/bundle');
    const { mkdtempSync, writeFileSync: write } = await import('node:fs');
    const os = await import('node:os');

    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(
      downloadAsset('https://example.test/x', path.join(os.tmpdir(), 'x'), fetchImpl),
    ).rejects.toThrowError(/404/);

    const bogus = path.join(mkdtempSync(path.join(os.tmpdir(), 'helio-bad-')), 'bad.tar.gz');
    write(bogus, 'not a tarball');
    expect(() => extractTarGz(bogus, path.join(os.tmpdir(), 'helio-bad-out'))).toThrowError(
      /could not extract/,
    );
  });

  it('rejects a latest release without a tag and a manifest without a version', async () => {
    const { resolveLatestTag, verifyBundle } = await import('../src/lib/bundle');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(resolveLatestTag(fetchImpl)).rejects.toThrowError(/no tag/);

    const dir = bundleDir({ 'docker-compose.yml': 'x' }, { name: 'helio', version: '', files: {} });
    expect(() => verifyBundle(dir)).toThrowError(/not a helio bundle/);
  });
});
