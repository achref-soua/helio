import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  cleanupSelfUpdateLeftover,
  isSelfUpdateNeeded,
  selfUpdateAssetName,
  selfUpdateBinary,
} from '../src/lib/self-update';

function tempExec(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'helio-su-'));
  const exec = path.join(dir, 'helio');
  writeFileSync(exec, 'OLD');
  return exec;
}

/** A download stand-in that drops the "new binary" where the swap expects it. */
const writeNew = async (_url: string, dest: string) => writeFileSync(dest, 'NEW');

describe('selfUpdateAssetName', () => {
  it('maps each supported platform/arch to its release asset', () => {
    expect(selfUpdateAssetName('linux', 'x64')).toBe('helio-linux-x64');
    expect(selfUpdateAssetName('linux', 'arm64')).toBe('helio-linux-arm64');
    expect(selfUpdateAssetName('darwin', 'x64')).toBe('helio-darwin-x64');
    expect(selfUpdateAssetName('darwin', 'arm64')).toBe('helio-darwin-arm64');
    expect(selfUpdateAssetName('win32', 'x64')).toBe('helio-windows-x64.exe');
  });

  it('returns null for unsupported targets', () => {
    expect(selfUpdateAssetName('win32', 'arm64')).toBeNull();
    expect(selfUpdateAssetName('freebsd', 'x64')).toBeNull();
    expect(selfUpdateAssetName('linux', 'ppc64')).toBeNull();
  });
});

describe('isSelfUpdateNeeded', () => {
  it('ignores a leading v and only updates when the version differs', () => {
    expect(isSelfUpdateNeeded('v2.0.1', 'v2.0.5')).toBe(true);
    expect(isSelfUpdateNeeded('2.0.1', 'v2.0.5')).toBe(true);
    expect(isSelfUpdateNeeded('v2.0.5', 'v2.0.5')).toBe(false);
    expect(isSelfUpdateNeeded('2.0.5', 'v2.0.5')).toBe(false);
  });
});

describe('selfUpdateBinary', () => {
  it('downloads the right asset and renames it over the binary (POSIX, real fs)', async () => {
    const exec = tempExec();
    const download = vi.fn(writeNew);
    const result = await selfUpdateBinary('v2.0.5', {
      platform: 'linux',
      arch: 'x64',
      execPath: exec,
      download,
    });
    expect(result.updated).toBe(true);
    expect(download).toHaveBeenCalledWith(
      'https://github.com/achref-soua/helio/releases/download/v2.0.5/helio-linux-x64',
      `${exec}.new`,
    );
    expect(readFileSync(exec, 'utf8')).toBe('NEW');
    expect(existsSync(`${exec}.new`)).toBe(false);
  });

  it('moves the locked binary aside before swapping on Windows (real fs)', async () => {
    const exec = tempExec();
    const result = await selfUpdateBinary('v2.0.5', {
      platform: 'win32',
      arch: 'x64',
      execPath: exec,
      download: writeNew,
    });
    expect(result.updated).toBe(true);
    expect(readFileSync(exec, 'utf8')).toBe('NEW');
    // The previous binary is preserved as .old for the next run to clear.
    expect(readFileSync(`${exec}.old`, 'utf8')).toBe('OLD');
  });

  it('defaults to the host platform/arch/execPath', async () => {
    // The test host (linux x64) takes the POSIX path through the real defaults.
    const exec = tempExec();
    const result = await selfUpdateBinary('v2.0.5', { execPath: exec, download: writeNew });
    expect(result.updated).toBe(true);
    expect(readFileSync(exec, 'utf8')).toBe('NEW');
  });

  it('does nothing on an unsupported platform', async () => {
    const download = vi.fn(writeNew);
    const result = await selfUpdateBinary('v2.0.5', {
      platform: 'win32',
      arch: 'arm64',
      execPath: '/x/helio',
      download,
    });
    expect(result.updated).toBe(false);
    expect(result.reason).toContain('win32/arm64');
    expect(download).not.toHaveBeenCalled();
  });
});

describe('cleanupSelfUpdateLeftover', () => {
  it('removes the .old sibling with the real remover', () => {
    const exec = tempExec();
    writeFileSync(`${exec}.old`, 'stale');
    cleanupSelfUpdateLeftover(exec);
    expect(existsSync(`${exec}.old`)).toBe(false);
  });

  it('never throws when removal fails', () => {
    const throwing = vi.fn(() => {
      throw new Error('locked');
    });
    expect(() => cleanupSelfUpdateLeftover('/bin/helio', throwing)).not.toThrow();
    expect(throwing).toHaveBeenCalledWith('/bin/helio.old');
  });
});
