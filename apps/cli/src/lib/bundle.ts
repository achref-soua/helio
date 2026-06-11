import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Release-bundle acquisition: resolve a tag, download the tarball from
 * GitHub releases (or take a local file for air-gapped installs), verify
 * its checksum manifest, and extract it. The GitHub API is only used for
 * "latest" — explicit versions build direct asset URLs, which dodges the
 * unauthenticated rate limit.
 */

export const REPO = 'achref-soua/helio';
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function bundleAssetName(tag: string): string {
  return `helio-bundle-${tag}.tar.gz`;
}

export function assetUrl(tag: string, asset: string): string {
  return `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
}

export async function resolveLatestTag(fetchImpl: FetchLike = fetch): Promise<string> {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(
      `could not resolve the latest release (GitHub answered ${response.status}); ` +
        'pass --version vX.Y.Z to skip the lookup',
    );
  }
  const release = (await response.json()) as { tag_name?: string };
  if (!release.tag_name) throw new Error('the latest release has no tag');
  return release.tag_name;
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function downloadAsset(
  url: string,
  destination: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

/** Extract with the system tar (present on Linux, macOS, and Windows 10+). */
export function extractTarGz(archive: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'pipe' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `could not extract ${path.basename(archive)}: ${result.stderr?.toString() || result.error?.message || 'tar failed'}`,
    );
  }
}

export interface BundleManifest {
  name: string;
  version: string;
  files: Record<string, string>;
}

/**
 * Verify an extracted bundle against its manifest — every listed file
 * must exist and hash-match. Returns the manifest for the installer.
 */
export function verifyBundle(directory: string): BundleManifest {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('bundle has no manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BundleManifest;
  if (manifest.name !== 'helio' || !manifest.version) {
    throw new Error('manifest.json is not a helio bundle manifest');
  }
  for (const [file, digest] of Object.entries(manifest.files)) {
    const filePath = path.join(directory, file);
    if (!existsSync(filePath)) throw new Error(`bundle is missing ${file}`);
    const actual = sha256Hex(readFileSync(filePath));
    if (actual !== digest) {
      throw new Error(`bundle file ${file} failed its checksum (corrupted download?)`);
    }
  }
  return manifest;
}
