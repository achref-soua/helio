import { chmodSync, renameSync, rmSync } from 'node:fs';

import { assetUrl, downloadAsset, type FetchLike } from './bundle';

/**
 * Keeping the `helio` command itself current. `helio update` refreshes the
 * installed stack but, until this, never the binary that ran it — so the CLI
 * kept reporting whatever version was first installed (e.g. an old `helio
 * --version` long after the stack moved on). This downloads the matching
 * release binary and swaps it in place, in lockstep with the stack update.
 */

/** The release-asset name of the CLI binary for this platform, or null. */
export function selfUpdateAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === 'win32') return arch === 'x64' ? 'helio-windows-x64.exe' : null;
  const os = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : null;
  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  return os && cpu ? `helio-${os}-${cpu}` : null;
}

/** True when the installed binary already is `tag` (nothing to download). */
export function isSelfUpdateNeeded(currentVersion: string, tag: string): boolean {
  return currentVersion.replace(/^v/, '') !== tag.replace(/^v/, '');
}

export interface SelfUpdateDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  execPath?: string;
  download?: (url: string, dest: string, fetchImpl?: FetchLike) => Promise<void>;
  rename?: (from: string, to: string) => void;
  chmod?: (path: string, mode: number) => void;
  remove?: (path: string) => void;
}

export interface SelfUpdateResult {
  updated: boolean;
  reason?: string;
}

/**
 * Replace the running `helio` binary with the release build for `tag`.
 * Atomic: download next to the binary, then rename over it. POSIX keeps the
 * running process on its old inode, so replacing the live executable is safe;
 * Windows can't overwrite a locked .exe, so the old one is moved aside for a
 * later run to delete ({@link cleanupSelfUpdateLeftover}).
 */
export async function selfUpdateBinary(
  tag: string,
  deps: SelfUpdateDeps = {},
): Promise<SelfUpdateResult> {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const execPath = deps.execPath ?? process.execPath;
  const download = deps.download ?? downloadAsset;
  const rename = deps.rename ?? renameSync;
  const chmod = deps.chmod ?? chmodSync;
  const remove = deps.remove ?? ((path: string) => rmSync(path, { force: true }));

  const asset = selfUpdateAssetName(platform, arch);
  if (!asset) return { updated: false, reason: `no published binary for ${platform}/${arch}` };

  const next = `${execPath}.new`;
  await download(assetUrl(tag, asset), next);
  chmod(next, 0o755);

  if (platform === 'win32') {
    const old = `${execPath}.old`;
    remove(old);
    // A running .exe can be renamed (the handle stays valid) but not
    // overwritten; move it aside, then move the new one into place.
    rename(execPath, old);
    rename(next, execPath);
  } else {
    rename(next, execPath);
  }
  return { updated: true };
}

/** Best-effort removal of the Windows self-update leftover from a prior run. */
export function cleanupSelfUpdateLeftover(
  execPath: string = process.execPath,
  remove: (path: string) => void = (path) => rmSync(path, { force: true }),
): void {
  try {
    remove(`${execPath}.old`);
  } catch {
    // The previous binary may still hold the handle; a later run clears it.
  }
}
