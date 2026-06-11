import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * The installation directory (`~/.helio` by default, `HELIO_HOME` to
 * override — also what the tests use). Everything `helio` manages lives
 * here: the pinned compose file, the .env, downloaded release bundles,
 * and local backups.
 */

export function helioHome(env: Record<string, string | undefined> = process.env): string {
  return env.HELIO_HOME?.trim() || path.join(homedir(), '.helio');
}

export interface InstallPaths {
  home: string;
  composeFile: string;
  envFile: string;
  manifestFile: string;
  backupsDir: string;
  releasesDir: string;
}

export function installPaths(home: string = helioHome()): InstallPaths {
  return {
    home,
    composeFile: path.join(home, 'docker-compose.yml'),
    envFile: path.join(home, '.env'),
    manifestFile: path.join(home, 'manifest.json'),
    backupsDir: path.join(home, 'backups'),
    releasesDir: path.join(home, 'releases'),
  };
}

export interface InstallManifest {
  name: 'helio';
  version: string;
  installedAt: string;
  files: Record<string, string>;
}

export function readManifest(paths: InstallPaths): InstallManifest | null {
  if (!existsSync(paths.manifestFile)) return null;
  try {
    return JSON.parse(readFileSync(paths.manifestFile, 'utf8')) as InstallManifest;
  } catch {
    return null;
  }
}

export function writeManifest(
  paths: InstallPaths,
  manifest: Omit<InstallManifest, 'installedAt'>,
): void {
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(
    paths.manifestFile,
    `${JSON.stringify({ ...manifest, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export function isInstalled(paths: InstallPaths): boolean {
  return existsSync(paths.composeFile) && existsSync(paths.envFile);
}
